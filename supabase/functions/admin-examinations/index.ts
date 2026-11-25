import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function getSecret(name: string): string {
  const raw = Deno.env.get(name);
  if (!raw) throw new Error(`Missing server secret: ${name}`);
  const parsed = JSON.parse(raw);
  const value = parsed.default;
  if (typeof value !== "string" || !value) {
    throw new Error(`Invalid server secret: ${name}`);
  }
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ success: false, message: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("Supabase URL is not configured.");

    const publishableKey = getSecret("SUPABASE_PUBLISHABLE_KEYS");
    const serviceRoleKey = getSecret("SUPABASE_SECRET_KEYS");
    const authHeader = req.headers.get("Authorization") || "";

    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ success: false, message: "Administrator sign-in is required." }, 401);
    }

    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(authHeader.slice(7));

    if (authError || !authData.user) {
      return jsonResponse({ success: false, message: "Your administrator session is invalid or has expired." }, 401);
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile, error: profileError } = await db
      .from("user_profiles")
      .select("id, role, active, full_name")
      .eq("id", authData.user.id)
      .single();

    if (
      profileError ||
      !profile ||
      profile.active !== true ||
      !["admin", "super_admin"].includes(profile.role)
    ) {
      return jsonResponse({ success: false, message: "You are not authorised to manage examinations." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "list_examinations") {
      const { data: exams, error: examError } = await db
        .from("examinations")
        .select("id, title, subject, class_id, status, accepts_new_candidates, duration_minutes, starts_at, ends_at, created_at")
        .order("created_at", { ascending: false });

      if (examError) throw examError;

      const rows = exams || [];
      const classIds = [...new Set(rows.map((e: any) => e.class_id).filter(Boolean))];

      const [classResult, studentResult, sessionResult] = await Promise.all([
        classIds.length
          ? db.from("classes").select("id, name, level").in("id", classIds)
          : Promise.resolve({ data: [], error: null }),
        classIds.length
          ? db.from("students").select("id, class_id").in("class_id", classIds).eq("active", true)
          : Promise.resolve({ data: [], error: null }),
        rows.length
          ? db.from("exam_sessions").select("exam_id, student_id").in("exam_id", rows.map((e: any) => e.id))
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (classResult.error) throw classResult.error;
      if (studentResult.error) throw studentResult.error;
      if (sessionResult.error) throw sessionResult.error;

      const classMap = new Map((classResult.data || []).map((c: any) => [c.id, c]));
      const candidateCounts = new Map<string, number>();
      for (const student of studentResult.data || []) {
        candidateCounts.set(student.class_id, (candidateCounts.get(student.class_id) || 0) + 1);
      }
      const attemptedCounts = new Map<string, Set<string>>();
      for (const session of sessionResult.data || []) {
        if (!attemptedCounts.has(session.exam_id)) attemptedCounts.set(session.exam_id, new Set());
        attemptedCounts.get(session.exam_id)!.add(session.student_id);
      }

      const examinations = rows.map((exam: any) => {
        const assignedClass: any = classMap.get(exam.class_id);
        return {
          ...exam,
          class_name: assignedClass?.name || null,
          class_label: assignedClass
            ? [assignedClass.name, assignedClass.level].filter(Boolean).join(" — ")
            : null,
          candidate_count: candidateCounts.get(exam.class_id) || 0,
          attempted_count: attemptedCounts.get(exam.id)?.size || 0,
        };
      });

      return jsonResponse({ success: true, examinations });
    }

    if (action === "set_candidate_entry") {
      const examId = body.exam_id;
      const accepting = body.accepts_new_candidates;

      if (!isUuid(examId) || typeof accepting !== "boolean") {
        return jsonResponse({ success: false, message: "A valid examination and entry setting are required." }, 400);
      }

      const { data: exam, error: examError } = await db
        .from("examinations")
        .select("id, status, accepts_new_candidates")
        .eq("id", examId)
        .maybeSingle();

      if (examError) throw examError;
      if (!exam) return jsonResponse({ success: false, message: "Examination not found." }, 404);

      const allowed = ["ready", "active", "completed"];
      if (accepting && !allowed.includes(String(exam.status))) {
        return jsonResponse({ success: false, message: "This examination cannot be opened in its current status." }, 409);
      }

      const nextStatus = accepting ? "active" : (exam.status === "active" ? "completed" : exam.status);
      const { data: updated, error: updateError } = await db
        .from("examinations")
        .update({
          status: nextStatus,
          accepts_new_candidates: accepting,
          updated_at: new Date().toISOString(),
        })
        .eq("id", examId)
        .select("id, status, accepts_new_candidates")
        .single();

      if (updateError) throw updateError;

      return jsonResponse({
        success: true,
        message: accepting
          ? "Examination reopened. Candidates with no previous attempt may enter; previous candidates remain locked unless individually authorised."
          : "New candidate entry has been closed. Candidates already in progress can continue.",
        examination: updated,
      });
    }

    if (action === "list_exam_candidates") {
      const examId = body.exam_id;
      if (!isUuid(examId)) {
        return jsonResponse({ success: false, message: "A valid examination ID is required." }, 400);
      }

      const { data: exam, error: examError } = await db
        .from("examinations")
        .select("id, title, subject, class_id")
        .eq("id", examId)
        .maybeSingle();

      if (examError) throw examError;
      if (!exam) return jsonResponse({ success: false, message: "Examination not found." }, 404);

      const [studentsResult, sessionsResult, authResult] = await Promise.all([
        db.from("students")
          .select("id, admission_number, full_name, class_id, active")
          .eq("class_id", exam.class_id)
          .order("full_name", { ascending: true })
          .limit(1000),
        db.from("exam_sessions")
          .select("id, student_id, status, attempt_number, started_at, deadline_at, submitted_at, answered_count, score")
          .eq("exam_id", examId)
          .order("attempt_number", { ascending: true })
          .limit(5000),
        db.from("exam_retake_authorizations")
          .select("id, student_id, status, reason, authorized_at, authorized_by, consumed_at, consumed_session_id, revoked_at")
          .eq("exam_id", examId)
          .order("authorized_at", { ascending: false })
          .limit(2000),
      ]);

      if (studentsResult.error) throw studentsResult.error;
      if (sessionsResult.error) throw sessionsResult.error;
      if (authResult.error) throw authResult.error;

      const sessionsByStudent = new Map<string, any[]>();
      for (const session of sessionsResult.data || []) {
        if (!sessionsByStudent.has(session.student_id)) sessionsByStudent.set(session.student_id, []);
        sessionsByStudent.get(session.student_id)!.push(session);
      }

      const authByStudent = new Map<string, any[]>();
      for (const authorization of authResult.data || []) {
        if (!authByStudent.has(authorization.student_id)) authByStudent.set(authorization.student_id, []);
        authByStudent.get(authorization.student_id)!.push(authorization);
      }

      const candidates = (studentsResult.data || []).map((student: any) => ({
        student,
        attempts: sessionsByStudent.get(student.id) || [],
        authorizations: authByStudent.get(student.id) || [],
      }));

      return jsonResponse({
        success: true,
        examination: exam,
        candidates,
        generated_at: new Date().toISOString(),
      });
    }

    if (action === "authorize_retake") {
      const examId = body.exam_id;
      const studentId = body.student_id;
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";

      if (!isUuid(examId) || !isUuid(studentId) || !reason || reason.length > 1000) {
        return jsonResponse({ success: false, message: "Examination, candidate and a reason (maximum 1,000 characters) are required." }, 400);
      }

      const { data: exam, error: examError } = await db
        .from("examinations")
        .select("id, class_id, status, accepts_new_candidates")
        .eq("id", examId)
        .maybeSingle();

      if (examError) throw examError;
      if (!exam) return jsonResponse({ success: false, message: "Examination not found." }, 404);
      if (exam.status !== "active" || exam.accepts_new_candidates !== true) {
        return jsonResponse({ success: false, message: "Reopen the examination before authorising a retake." }, 409);
      }

      const { data: student, error: studentError } = await db
        .from("students")
        .select("id, class_id, active")
        .eq("id", studentId)
        .maybeSingle();

      if (studentError) throw studentError;
      if (!student || student.active !== true || student.class_id !== exam.class_id) {
        return jsonResponse({ success: false, message: "The selected candidate is not active in this examination's class." }, 400);
      }

      const { data: attempts, error: attemptsError } = await db
        .from("exam_sessions")
        .select("id, status, attempt_number")
        .eq("exam_id", examId)
        .eq("student_id", studentId)
        .order("attempt_number", { ascending: false });

      if (attemptsError) throw attemptsError;
      if (!attempts || attempts.length === 0) {
        return jsonResponse({ success: false, message: "This candidate has not taken the examination. Reopening the examination already permits their first attempt." }, 409);
      }
      if (attempts.some((attempt: any) => attempt.status === "in_progress")) {
        return jsonResponse({ success: false, message: "This candidate already has an examination session in progress." }, 409);
      }

      const { data: pending, error: pendingError } = await db
        .from("exam_retake_authorizations")
        .select("id")
        .eq("exam_id", examId)
        .eq("student_id", studentId)
        .eq("status", "pending")
        .maybeSingle();

      if (pendingError) throw pendingError;
      if (pending) {
        return jsonResponse({ success: false, message: "This candidate already has a pending retake authorisation." }, 409);
      }

      const { data: authorization, error: insertError } = await db
        .from("exam_retake_authorizations")
        .insert({
          exam_id: examId,
          student_id: studentId,
          authorized_by: authData.user.id,
          reason,
          status: "pending",
        })
        .select("id, exam_id, student_id, status, reason, authorized_at")
        .single();

      if (insertError) {
        if (insertError.code === "23505") {
          return jsonResponse({ success: false, message: "A pending retake authorisation already exists for this candidate." }, 409);
        }
        throw insertError;
      }

      return jsonResponse({
        success: true,
        message: "Individual retake authorised. The approval can be used once by this candidate while the examination is open.",
        authorization,
      });
    }

    if (action === "revoke_retake") {
      const authorizationId = body.authorization_id;
      if (!isUuid(authorizationId)) {
        return jsonResponse({ success: false, message: "A valid retake authorisation ID is required." }, 400);
      }

      const { data: authorization, error: authLookupError } = await db
        .from("exam_retake_authorizations")
        .select("id, status, exam_id, student_id")
        .eq("id", authorizationId)
        .maybeSingle();

      if (authLookupError) throw authLookupError;
      if (!authorization) return jsonResponse({ success: false, message: "Retake authorisation not found." }, 404);
      if (authorization.status !== "pending") {
        return jsonResponse({ success: false, message: "Only a pending retake authorisation can be revoked." }, 409);
      }

      const { data: revoked, error: revokeError } = await db
        .from("exam_retake_authorizations")
        .update({
          status: "revoked",
          revoked_at: new Date().toISOString(),
          revoked_by: authData.user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", authorizationId)
        .eq("status", "pending")
        .select("id, status, revoked_at")
        .maybeSingle();

      if (revokeError) throw revokeError;
      if (!revoked) {
        return jsonResponse({ success: false, message: "The authorisation was already used or revoked." }, 409);
      }

      return jsonResponse({
        success: true,
        message: "Pending retake authorisation revoked.",
        authorization: revoked,
      });
    }

    return jsonResponse({ success: false, message: "Unknown examination-management action." }, 400);
  } catch (error) {
    console.error("admin-examinations error:", error);
    return jsonResponse({
      success: false,
      message: error instanceof Error ? error.message : "An unexpected server error occurred.",
    }, 500);
  }
});
