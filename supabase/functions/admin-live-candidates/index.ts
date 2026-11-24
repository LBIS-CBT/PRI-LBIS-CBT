import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, message: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("Supabase URL is not configured.");

    const publishableKey = getSecret("SUPABASE_PUBLISHABLE_KEYS");
    const serviceRoleKey = getSecret("SUPABASE_SECRET_KEYS");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ success: false, message: "Authentication required." }, 401);
    }

    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(authHeader.slice(7));
    if (authError || !authData.user) {
      return jsonResponse({ success: false, message: "Your login session is invalid or expired." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile, error: profileError } = await adminClient
      .from("user_profiles")
      .select("id, role, active")
      .eq("id", authData.user.id)
      .single();

    if (profileError || !profile || profile.active !== true || !["admin", "super_admin"].includes(profile.role)) {
      return jsonResponse({ success: false, message: "You are not authorized to monitor live candidates." }, 403);
    }

    const body = await req.json();
    if (body.action !== "list_live_candidates") {
      return jsonResponse({ success: false, message: "Unknown live-candidates action." }, 400);
    }

    // Only sessions that are genuinely in progress are shown.
    const { data: sessions, error: sessionError } = await adminClient
      .from("exam_sessions")
      .select("id, exam_id, student_id, status, started_at, deadline_at, answered_count")
      .eq("status", "in_progress")
      .order("started_at", { ascending: false })
      .limit(500);

    if (sessionError) throw sessionError;

    const sessionRows = sessions || [];
    if (sessionRows.length === 0) {
      return jsonResponse({
        success: true,
        total: 0,
        candidates: [],
        generated_at: new Date().toISOString(),
        truncated: false,
      });
    }

    const studentIds = [...new Set(sessionRows.map((s) => s.student_id).filter(Boolean))];
    const examIds = [...new Set(sessionRows.map((s) => s.exam_id).filter(Boolean))];

    const [studentResult, examResult] = await Promise.all([
      adminClient.from("students")
        .select("id, admission_number, full_name")
        .in("id", studentIds),
      adminClient.from("examinations")
        .select("id, title, subject, class_id")
        .in("id", examIds),
    ]);

    if (studentResult.error) throw studentResult.error;
    if (examResult.error) throw examResult.error;

    const students = studentResult.data || [];
    const examinations = examResult.data || [];
    const classIds = [...new Set(examinations.map((e) => e.class_id).filter(Boolean))];

    const classResult = classIds.length
      ? await adminClient.from("classes").select("id, name, level").in("id", classIds)
      : { data: [], error: null };

    if (classResult.error) throw classResult.error;

    const studentMap = new Map(students.map((s) => [s.id, s]));
    const classMap = new Map((classResult.data || []).map((c) => [c.id, c]));
    const examMap = new Map(examinations.map((e) => {
      const assignedClass = classMap.get(e.class_id);
      return [e.id, {
        id: e.id,
        title: e.title,
        subject: e.subject,
        class_name: assignedClass?.name || null,
        class_level: assignedClass?.level || null,
      }];
    }));

    const candidates = sessionRows.map((session) => ({
      student: studentMap.get(session.student_id) || null,
      examination: examMap.get(session.exam_id) || null,
      started_at: session.started_at,
      deadline_at: session.deadline_at,
      answered_count: session.answered_count ?? 0,
      status: session.status,
    }));

    return jsonResponse({
      success: true,
      total: candidates.length,
      candidates,
      generated_at: new Date().toISOString(),
      truncated: sessionRows.length === 500,
    });
  } catch (error) {
    console.error("admin-live-candidates error:", error);
    return jsonResponse({
      success: false,
      message: error instanceof Error ? error.message : "An unexpected server error occurred.",
    }, 500);
  }
});
