import { createClient } from "npm:@supabase/supabase-js@2";

/* LBIS CBT — TEACHER EXAMINATIONS EDGE FUNCTION
   Version 1.1 — adds protected deletion of unused examinations. */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function getSecret(name: string): string {
  const raw = Deno.env.get(name);
  if (!raw) throw new Error(`Missing server secret: ${name}`);
  let value = raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.default === "string") value = parsed.default;
  } catch {}
  if (!value || typeof value !== "string") throw new Error(`Invalid server secret: ${name}`);
  return value;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function validUuid(value: unknown): boolean {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseOptionalDate(value: unknown): Date | null | false {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? false : date;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, message: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("Supabase URL is not configured.");
    const publishableKey = getSecret("SUPABASE_PUBLISHABLE_KEYS");
    const serviceRoleKey = getSecret("SUPABASE_SECRET_KEYS");
    const authHeader = req.headers.get("Authorization") || "";

    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ success: false, message: "Authentication required. Please sign in." }, 401);
    }
    const accessToken = authHeader.slice(7).trim();
    if (!accessToken) return jsonResponse({ success: false, message: "Invalid authentication token." }, 401);

    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      return jsonResponse({ success: false, message: "Your login session is invalid or expired. Please sign in again." }, 401);
    }
    const authenticatedUserId = authData.user.id;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await adminClient
      .from("user_profiles")
      .select("id, role, active, full_name, staff_code")
      .eq("id", authenticatedUserId)
      .maybeSingle();

    if (profileError || !profile || profile.active !== true || profile.role !== "teacher") {
      return jsonResponse({ success: false, message: "Only active teacher accounts can use this examination service." }, 403);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ success: false, message: "A valid request body is required." }, 400);
    }

    const action = body.action;

    if (action === "list_classes") {
      const { data: classes, error } = await adminClient
        .from("classes")
        .select("id, name, level, sort_order")
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) {
        console.error("LIST CLASSES ERROR:", error);
        return jsonResponse({ success: false, message: "Unable to retrieve the active class list." }, 500);
      }
      return jsonResponse({ success: true, message: "Classes loaded successfully.", classes: classes || [], total: classes?.length || 0 });
    }

    if (action === "list_teacher_examinations") {
      const { data: examinations, error } = await adminClient
        .from("examinations")
        .select(`
          id, title, subject, class_id, duration_minutes, status, accepts_new_candidates,
          starts_at, ends_at, total_form_items, extracted_question_count,
          unsupported_question_count, total_marks, created_at, updated_at
        `)
        .eq("created_by", authenticatedUserId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        console.error("LIST TEACHER EXAMINATIONS ERROR:", error);
        return jsonResponse({ success: false, message: "Unable to retrieve your examinations." }, 500);
      }

      const rows = examinations || [];
      const classIds = [...new Set(rows.map((exam: any) => exam.class_id).filter(Boolean))];
      let classMap = new Map<string, any>();

      if (classIds.length) {
        const { data: classes, error: classError } = await adminClient
          .from("classes").select("id, name, level").in("id", classIds);
        if (classError) {
          console.error("EXAMINATION CLASS LOOKUP ERROR:", classError);
          return jsonResponse({ success: false, message: "Unable to retrieve examination class information." }, 500);
        }
        classMap = new Map((classes || []).map((item: any) => [item.id, item]));
      }

      const result = rows.map((exam: any) => ({ ...exam, class: classMap.get(exam.class_id) || null }));
      return jsonResponse({ success: true, message: "Examinations retrieved successfully.", examinations: result, total: result.length });
    }

    if (action === "create_examination") {
      const title = cleanText(body.title);
      const subject = cleanText(body.subject);
      const classId = body.class_id;
      const duration = Number(body.duration_minutes);

      if (!title || title.length > 160) return jsonResponse({ success: false, message: "Enter a valid examination title (maximum 160 characters)." }, 400);
      if (!subject || subject.length > 100) return jsonResponse({ success: false, message: "Enter a valid subject name (maximum 100 characters)." }, 400);
      if (!validUuid(classId)) return jsonResponse({ success: false, message: "Select a valid class." }, 400);
      if (!Number.isInteger(duration) || duration < 1 || duration > 300) {
        return jsonResponse({ success: false, message: "Duration must be between 1 and 300 whole minutes." }, 400);
      }

      const startsAt = parseOptionalDate(body.starts_at);
      const endsAt = parseOptionalDate(body.ends_at);
      if (startsAt === false || endsAt === false) return jsonResponse({ success: false, message: "An examination date or time is invalid." }, 400);
      if (startsAt instanceof Date && endsAt instanceof Date && endsAt <= startsAt) {
        return jsonResponse({ success: false, message: "The scheduled end must be later than the scheduled start." }, 400);
      }

      const { data: selectedClass, error: classError } = await adminClient
        .from("classes").select("id, name, level").eq("id", classId).eq("active", true).maybeSingle();
      if (classError) {
        console.error("CLASS VALIDATION ERROR:", classError);
        return jsonResponse({ success: false, message: "Unable to verify the selected class." }, 500);
      }
      if (!selectedClass) return jsonResponse({ success: false, message: "The selected class is inactive or unavailable. Refresh the class list." }, 400);

      const { data: examination, error: insertError } = await adminClient
        .from("examinations")
        .insert({
          title, subject, class_id: classId, created_by: authenticatedUserId,
          status: "ready", accepts_new_candidates: false, duration_minutes: duration,
          starts_at: startsAt instanceof Date ? startsAt.toISOString() : null,
          ends_at: endsAt instanceof Date ? endsAt.toISOString() : null,
          total_form_items: 0, extracted_question_count: 0, unsupported_question_count: 0, total_marks: 0,
        })
        .select(`
          id, title, subject, class_id, duration_minutes, status, accepts_new_candidates,
          starts_at, ends_at, total_form_items, extracted_question_count,
          unsupported_question_count, total_marks, created_at
        `)
        .single();

      if (insertError) {
        console.error("CREATE EXAMINATION ERROR:", insertError);
        if (insertError.code === "23503") return jsonResponse({ success: false, message: "The selected class or teacher account is no longer available." }, 400);
        return jsonResponse({ success: false, message: "The examination could not be created. Please try again." }, 500);
      }
      return jsonResponse({ success: true, message: "Examination created successfully and is ready for question extraction.", examination: { ...examination, class: selectedClass } }, 201);
    }

    if (action === "delete_examination") {
      const examId = body.exam_id;
      if (!validUuid(examId) || body.confirmation !== "DELETE") {
        return jsonResponse({ success: false, message: "A valid examination and deletion confirmation are required." }, 400);
      }

      const { data: ownedExam, error: ownedError } = await adminClient
        .from("examinations")
        .select("id, title")
        .eq("id", examId)
        .eq("created_by", authenticatedUserId)
        .maybeSingle();

      if (ownedError) {
        console.error("DELETE EXAM OWNERSHIP CHECK:", ownedError);
        return jsonResponse({ success: false, message: "Unable to verify examination ownership." }, 500);
      }
      if (!ownedExam) return jsonResponse({ success: false, message: "Examination not found or it does not belong to your teacher account." }, 404);

      const { data: deletion, error: deleteError } = await adminClient.rpc("lbis_teacher_delete_unused_examination", {
        p_exam_id: examId,
        p_teacher_id: authenticatedUserId,
      });

      if (deleteError) {
        console.error("DELETE EXAMINATION RPC ERROR:", deleteError);
        return jsonResponse({ success: false, message: "The examination could not be deleted safely. No records were intentionally removed; contact the CBT administrator." }, 500);
      }
      if (!deletion?.success) {
        const code = deletion?.code;
        const status = code === "HAS_ATTEMPTS" ? 409 : code === "NOT_FOUND" ? 404 : 400;
        return jsonResponse({ success: false, message: deletion?.message || "The examination could not be deleted.", code }, status);
      }

      return jsonResponse({ success: true, message: `"${ownedExam.title}" was deleted successfully.` });
    }

    return jsonResponse({ success: false, message: "Unknown teacher-examinations action." }, 400);
  } catch (error) {
    console.error("TEACHER EXAMINATIONS FUNCTION ERROR:", error);
    return jsonResponse({
      success: false,
      message: "An unexpected server error occurred. Please contact the CBT administrator if the problem continues.",
    }, 500);
  }
});
