import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function getSecret(name: string): string {
  const raw = Deno.env.get(name);
  if (!raw) throw new Error(`Missing server secret: ${name}`);
  const parsed = JSON.parse(raw);
  const value = parsed.default;
  if (typeof value !== "string" || !value) throw new Error(`Invalid server secret: ${name}`);
  return value;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonPart(value: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function verifyStudentToken(token: string, signingSecret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = decodeJsonPart(parts[0]);
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const payload = decodeJsonPart(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    if (
      payload.iss !== "lbis-cbt" ||
      payload.aud !== "lbis-student" ||
      payload.role !== "student" ||
      typeof payload.sub !== "string" ||
      typeof payload.class_id !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp <= now
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, message: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("Supabase URL is not configured.");
    const publishableKey = getSecret("SUPABASE_PUBLISHABLE_KEYS");
    const serviceRoleKey = getSecret("SUPABASE_SECRET_KEYS");

    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse({ success: false, message: "Student sign-in is required. Please sign in again." }, 401);
    }

    const studentClaims = await verifyStudentToken(authorization.slice(7), serviceRoleKey);
    if (!studentClaims) {
      return jsonResponse({ success: false, message: "Your student session is invalid or has expired. Please sign in again." }, 401);
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Recheck the student and class on every dashboard request. This means a
    // deactivated student or class cannot continue using an old browser token.
    const { data: student, error: studentError } = await db
      .from("students")
      .select("id, admission_number, full_name, class_id, active")
      .eq("id", studentClaims.sub)
      .maybeSingle();

    if (studentError) throw studentError;
    if (!student || student.active !== true || student.class_id !== studentClaims.class_id) {
      return jsonResponse({ success: false, message: "Your student record is no longer active. Please contact the school administrator." }, 403);
    }

    const { data: assignedClass, error: classError } = await db
      .from("classes")
      .select("id, name, level, active")
      .eq("id", student.class_id)
      .maybeSingle();

    if (classError) throw classError;
    if (!assignedClass || assignedClass.active !== true) {
      return jsonResponse({ success: false, message: "Your registered class is not currently active. Please contact the school administrator." }, 403);
    }

    const { data: examinations, error: examError } = await db
      .from("examinations")
      .select("id, title, subject, status, accepts_new_candidates, duration_minutes, starts_at, ends_at, total_marks, extracted_question_count")
      .eq("class_id", assignedClass.id)
      .in("status", ["ready", "active", "completed"])
      .order("created_at", { ascending: false });

    if (examError) throw examError;

    const examRows = examinations || [];
    const examIds = examRows.map((exam) => exam.id);
    let attempts: any[] = [];

    if (examIds.length) {
      const { data, error } = await db
        .from("exam_sessions")
        .select("id, exam_id, status, started_at, deadline_at, submitted_at, answered_count, score")
        .eq("student_id", student.id)
        .in("exam_id", examIds);
      if (error) throw error;
      attempts = data || [];
    }

    const attemptMap = new Map(attempts.map((attempt) => [attempt.exam_id, attempt]));
    const now = Date.now();

    const dashboardExaminations = examRows.map((exam) => {
      const attempt = attemptMap.get(exam.id) || null;
      const start = exam.starts_at ? new Date(exam.starts_at).getTime() : null;
      const end = exam.ends_at ? new Date(exam.ends_at).getTime() : null;
      let availability = "unavailable";
      let availability_message = "This examination is not currently available.";

      if (attempt?.status === "in_progress") {
        availability = "resume";
        availability_message = "You have an examination session in progress.";
      } else if (attempt) {
        availability = "attempted";
        availability_message = attempt.status === "submitted"
          ? "You have already submitted this examination."
          : "Your examination attempt has ended.";
      } else if (exam.status === "completed") {
        availability = "closed";
        availability_message = "This examination has been completed.";
      } else if (exam.status === "ready") {
        availability = "upcoming";
        availability_message = "This examination is being prepared.";
      } else if (exam.status === "active" && start !== null && now < start) {
        availability = "upcoming";
        availability_message = "This examination has not started yet.";
      } else if (exam.status === "active" && end !== null && now >= end) {
        availability = "closed";
        availability_message = "The examination time window has ended.";
      } else if (exam.status === "active" && exam.accepts_new_candidates === true) {
        availability = "available";
        availability_message = "You can enter this examination.";
      } else if (exam.status === "active") {
        availability = "closed";
        availability_message = "New candidates are not currently being accepted.";
      }

      return {
        id: exam.id,
        title: exam.title,
        subject: exam.subject,
        status: exam.status,
        availability,
        availability_message,
        duration_minutes: exam.duration_minutes,
        starts_at: exam.starts_at,
        ends_at: exam.ends_at,
        total_marks: exam.total_marks,
        question_count: exam.extracted_question_count,
        attempt: attempt ? {
          id: attempt.id,
          status: attempt.status,
          started_at: attempt.started_at,
          deadline_at: attempt.deadline_at,
          submitted_at: attempt.submitted_at,
          answered_count: attempt.answered_count,
          score: attempt.score,
        } : null,
      };
    });

    return jsonResponse({
      success: true,
      generated_at: new Date().toISOString(),
      student: {
        id: student.id,
        admission_number: student.admission_number,
        full_name: student.full_name,
      },
      class: {
        id: assignedClass.id,
        name: assignedClass.name,
        level: assignedClass.level,
      },
      examinations: dashboardExaminations,
    });
  } catch (error) {
    console.error("student-dashboard error:", error);
    return jsonResponse({
      success: false,
      message: "Unable to load your student dashboard. Please try again.",
    }, 500);
  }
});
