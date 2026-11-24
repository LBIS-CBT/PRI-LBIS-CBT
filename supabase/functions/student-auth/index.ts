import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;
const PBKDF2_MIN_ITERATIONS = 100000;
const PBKDF2_MAX_ITERATIONS = 1000000;

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

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error("Invalid stored password hash.");
  return new Uint8Array(value.match(/.{2}/g)!.map((part) => parseInt(part, 16)));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    256,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function signStudentToken(payload: Record<string, unknown>, signingSecret: string): Promise<string> {
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)));
  return `${signingInput}.${base64Url(signature)}`;
}

// A small per-isolate throttle is supplementary protection only. It is not a
// substitute for a durable, shared rate limiter at the gateway/database layer.
const failedAttempts = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (failedAttempts.get(key) || []).filter((time) => now - time < WINDOW_MS);
  failedAttempts.set(key, recent);
  return recent.length >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const recent = (failedAttempts.get(key) || []).filter((time) => now - time < WINDOW_MS);
  recent.push(now);
  failedAttempts.set(key, recent);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, message: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("Supabase URL is not configured.");

    const publishableKey = getSecret("SUPABASE_PUBLISHABLE_KEYS");
    const serviceRoleKey = getSecret("SUPABASE_SECRET_KEYS");
    const body = await req.json();

    const admissionNumber = typeof body.admission_number === "string"
      ? body.admission_number.trim()
      : "";
    const password = typeof body.exam_password === "string" ? body.exam_password : "";

    // Reject filter metacharacters and unusually long values before querying.
    if (!/^[a-z0-9][a-z0-9/.-]{0,59}$/i.test(admissionNumber) || password.length < 1 || password.length > 128) {
      return jsonResponse({ success: false, message: "Admission Number or Examination Password is incorrect." }, 401);
    }

    const rateKey = admissionNumber.toUpperCase();
    if (isRateLimited(rateKey)) {
      return jsonResponse({
        success: false,
        message: "Too many unsuccessful attempts. Please wait 15 minutes before trying again.",
      }, 429);
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Use a generic failure response so the endpoint does not reveal whether
    // an admission number exists or whether a student is active.
    const { data: student, error: studentError } = await db
      .from("students")
      .select("id, admission_number, full_name, class_id, active")
      .ilike("admission_number", admissionNumber)
      .maybeSingle();

    if (studentError || !student || student.active !== true || !student.class_id) {
      recordFailure(rateKey);
      return jsonResponse({ success: false, message: "Admission Number or Examination Password is incorrect." }, 401);
    }

    const { data: settings, error: settingsError } = await db
      .from("exam_access_settings")
      .select("password_hash, password_salt, hash_iterations")
      .eq("id", 1)
      .maybeSingle();

    if (settingsError || !settings?.password_hash || !settings?.password_salt) {
      console.error("Student login: global examination password is not configured.", settingsError);
      return jsonResponse({ success: false, message: "Student sign-in is temporarily unavailable. Please contact the school administrator." }, 503);
    }

    const iterations = Number(settings.hash_iterations);
    if (!Number.isInteger(iterations) || iterations < PBKDF2_MIN_ITERATIONS || iterations > PBKDF2_MAX_ITERATIONS) {
      throw new Error("The stored examination password settings are invalid.");
    }

    const suppliedHash = await derivePasswordHash(password, fromHex(settings.password_salt), iterations);
    const storedHash = fromHex(settings.password_hash);
    if (!constantTimeEqual(suppliedHash, storedHash)) {
      recordFailure(rateKey);
      return jsonResponse({ success: false, message: "Admission Number or Examination Password is incorrect." }, 401);
    }

    const { data: assignedClass, error: classError } = await db
      .from("classes")
      .select("id, name, level, active")
      .eq("id", student.class_id)
      .maybeSingle();

    if (classError || !assignedClass || assignedClass.active !== true) {
      recordFailure(rateKey);
      return jsonResponse({ success: false, message: "Your student record does not have an active class. Please contact the school administrator." }, 403);
    }

    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = {
      iss: "lbis-cbt",
      aud: "lbis-student",
      sub: student.id,
      role: "student",
      class_id: assignedClass.id,
      iat: now,
      exp: now + TOKEN_LIFETIME_SECONDS,
    };
    const studentToken = await signStudentToken(tokenPayload, serviceRoleKey);

    failedAttempts.delete(rateKey);

    return jsonResponse({
      success: true,
      message: "Student identity verified successfully.",
      student_token: studentToken,
      expires_at: new Date((now + TOKEN_LIFETIME_SECONDS) * 1000).toISOString(),
      student: {
        id: student.id,
        admission_number: student.admission_number,
        full_name: student.full_name,
        class_id: assignedClass.id,
        class_name: assignedClass.name,
        class_level: assignedClass.level,
      },
    });
  } catch (error) {
    console.error("student-auth error:", error);
    return jsonResponse({
      success: false,
      message: "Student sign-in is temporarily unavailable. Please try again.",
    }, 500);
  }
});
