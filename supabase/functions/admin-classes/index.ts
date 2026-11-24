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
      .from("user_profiles").select("id, role, active").eq("id", authData.user.id).single();

    if (profileError || !profile || profile.active !== true || !["admin", "super_admin"].includes(profile.role)) {
      return jsonResponse({ success: false, message: "You are not authorized to manage classes." }, 403);
    }

    const body = await req.json();

    if (body.action === "list_classes") {
      const { data: classes, error } = await adminClient
        .from("classes")
        .select("id, name, level, sort_order, active")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return jsonResponse({ success: true, classes: classes || [] });
    }

    if (body.action === "create_class") {
      const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
      const level = typeof body.level === "string" ? body.level.trim().replace(/\s+/g, " ") : "";
      const sortOrderRaw = body.sort_order === "" || body.sort_order === undefined ? 0 : Number(body.sort_order);

      if (!name) return jsonResponse({ success: false, message: "Class name is required." }, 400);
      if (name.length > 100 || level.length > 80) {
        return jsonResponse({ success: false, message: "Class name or level is too long." }, 400);
      }
      if (!Number.isInteger(sortOrderRaw) || sortOrderRaw < 0) {
        return jsonResponse({ success: false, message: "Display order must be a non-negative whole number." }, 400);
      }

      const { data: existing, error: duplicateError } = await adminClient
        .from("classes").select("id").ilike("name", name).limit(1).maybeSingle();
      if (duplicateError) throw duplicateError;
      if (existing) return jsonResponse({ success: false, message: "A class with that name already exists." }, 409);

      const { data: created, error: insertError } = await adminClient
        .from("classes")
        .insert({ name, level: level || null, sort_order: sortOrderRaw, active: true })
        .select("id, name, level, sort_order, active, created_at")
        .single();

      if (insertError) {
        if (insertError.code === "23505") {
          return jsonResponse({ success: false, message: "A class with that name already exists." }, 409);
        }
        throw insertError;
      }

      return jsonResponse({ success: true, message: "Class created successfully.", class: created }, 201);
    }

    return jsonResponse({ success: false, message: "Unknown class-management action." }, 400);
  } catch (error) {
    console.error("admin-classes error:", error);
    return jsonResponse({
      success: false,
      message: error instanceof Error ? error.message : "An unexpected server error occurred.",
    }, 500);
  }
});
