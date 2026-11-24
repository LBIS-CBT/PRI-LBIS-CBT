import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ITERATIONS = 310000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
function secret(name: string): string {
  const raw = Deno.env.get(name);
  if (!raw) throw new Error(`Missing server secret: ${name}`);
  const value = JSON.parse(raw).default;
  if (typeof value !== "string" || !value) throw new Error(`Invalid server secret: ${name}`);
  return value;
}
function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, material, 256);
  return hex(new Uint8Array(bits));
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    if (!url) throw new Error("Supabase URL is not configured.");
    const publishable = secret("SUPABASE_PUBLISHABLE_KEYS");
    const service = secret("SUPABASE_SECRET_KEYS");
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ success: false, message: "Administrator sign-in required." }, 401);
    const auth = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(authorization.slice(7));
    if (authError || !authData.user) return json({ success: false, message: "Your administrator session is invalid or expired." }, 401);
    const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await db.from("user_profiles")
      .select("id,role,active").eq("id", authData.user.id).single();
    if (profileError || !profile || profile.active !== true || !["admin", "super_admin"].includes(profile.role)) {
      return json({ success: false, message: "Only an active administrator can reset the examination password." }, 403);
    }
    const body = await req.json();
    if (body.action !== "reset_global_password") return json({ success: false, message: "Unknown examination password action." }, 400);
    const password = typeof body.new_password === "string" ? body.new_password : "";
    if (password.length < 8 || password.length > 128) {
      return json({ success: false, message: "Use a password between 8 and 128 characters." }, 400);
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordHash = await hashPassword(password, salt);
    const { error } = await db.from("exam_access_settings").upsert({
      id: 1,
      password_hash: passwordHash,
      password_salt: hex(salt),
      hash_iterations: ITERATIONS,
      updated_at: new Date().toISOString(),
      updated_by: authData.user.id,
    }, { onConflict: "id" });
    if (error) throw error;
    return json({ success: true, message: "The global examination password has been reset. It now applies to all examinations and subjects." });
  } catch (error) {
    console.error("admin-exam-access error:", error);
    return json({ success: false, message: error instanceof Error ? error.message : "An unexpected server error occurred." }, 500);
  }
});
