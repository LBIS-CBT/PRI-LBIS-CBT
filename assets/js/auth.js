
(() => {
  "use strict";

  const SUPABASE_URL = "https://mbsbfhifbsdiryerqxbq.supabase.co";

  // Replace this placeholder with your Supabase PUBLISHABLE key.
  // Never put the Supabase secret/service-role key here.
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7UJC2JRYXUSJth87lEYq6w_xNfjdXLq";

  const STAFF_LOGIN_URL =
    `${SUPABASE_URL}/functions/v1/staff-login`;

  async function callStaffLogin(payload) {
    if (
      !SUPABASE_PUBLISHABLE_KEY ||
      SUPABASE_PUBLISHABLE_KEY === "PASTE_YOUR_PUBLISHABLE_KEY_HERE"
    ) {
      throw new Error("Supabase publishable key has not been configured.");
    }

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
      return {
        success: false,
        message: error.message
      };
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
        throw new Error("Login succeeded but the authentication session was not returned.");
      }

      // Keep the session limited to this browser tab.
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

  window.LBISAuth = {
    verifyAdminCode,
    adminLogin
  };
})();
