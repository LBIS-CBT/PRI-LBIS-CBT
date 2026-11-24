(() => {
  "use strict";

  const SUPABASE_URL = "https://mbsbfhifbsdiryerqxbq.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7UJC2JRYXUSJth87lEYq6w_xNfjdXLq";

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("Supabase JS library did not load.");
    return;
  }

  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        storage: window.sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    }
  );

  const STAFF_LOGIN_URL = `${SUPABASE_URL}/functions/v1/staff-login`;

  async function callStaffLogin(payload) {
    const response = await fetch(STAFF_LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_PUBLISHABLE_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.message || data.error || "Authentication failed.");
    }
    return data;
  }

  async function verifyAdminCode({ adminCode, role }) {
    try {
      const data = await callStaffLogin({
        action: "verify_staff_code",
        staff_code: adminCode,
        role
      });
      return {
        success: true,
        staff: data.staff || null,
        message: data.message || "Access code verified."
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async function adminLogin({ adminCode, role, password }) {
    try {
      const data = await callStaffLogin({
        action: "login",
        staff_code: adminCode,
        role,
        password
      });

      const session = data.session;
      if (!session?.access_token || !session?.refresh_token) {
        throw new Error("The authentication session was not returned.");
      }

      const { error } = await window.supabaseClient.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      });
      if (error) throw error;

      const staff = data.staff || {};
      sessionStorage.setItem("lbis_staff_profile", JSON.stringify({
        id: staff.id,
        full_name: staff.full_name,
        staff_code: staff.staff_code,
        role: staff.role
      }));

      return {
        success: true,
        staff,
        redirectUrl: "staff-dashboard.html"
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || "Unable to sign in."
      };
    }
  }

  window.LBISAuth = { verifyAdminCode, adminLogin };
})();