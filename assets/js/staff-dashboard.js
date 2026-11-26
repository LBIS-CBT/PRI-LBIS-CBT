(() => {
  "use strict";

  const dashboardShell = document.getElementById("dashboard-shell");
  const unsupportedDevice = document.getElementById("unsupported-device");
  const message = document.getElementById("dashboard-message");
  const signOutButton = document.getElementById("sign-out-button");

  if (!dashboardShell) return;

  const isPhoneWidth = window.matchMedia("(max-width: 600px)").matches;
  if (isPhoneWidth) {
    unsupportedDevice.hidden = false;
    return;
  }

  function showMessage(text) {
    message.textContent = text;
  }

  function roleLabel(role) {
    if (role === "super_admin") return "Super Administrator";
    if (role === "admin") return "Administrator";
    if (role === "teacher") return "Teacher";
    return "Staff";
  }

  async function redirectToLogin() {
    window.sessionStorage.removeItem("lbis_staff_profile");
    window.location.replace("admin-login.html");
  }

  function rememberDashboard() {
    window.sessionStorage.setItem("lbis_last_dashboard", "staff-dashboard.html");
  }

  async function loadDashboard() {
    if (!window.supabaseClient) {
      showMessage("The secure connection could not be initialized. Please reload this page.");
      return;
    }

    const { data: sessionData, error: sessionError } =
      await window.supabaseClient.auth.getSession();

    if (sessionError || !sessionData?.session) {
      await redirectToLogin();
      return;
    }

    const { data: profile, error: profileError } = await window.supabaseClient
      .from("user_profiles")
      .select("id, full_name, staff_code, role, admin_level, active")
      .eq("id", sessionData.session.user.id)
      .single();

    if (profileError || !profile) {
      showMessage("Your staff profile could not be loaded. Please contact the school CBT administrator.");
      return;
    }

    if (profile.active !== true) {
      await window.supabaseClient.auth.signOut();
      window.sessionStorage.removeItem("lbis_staff_profile");
      await redirectToLogin();
      return;
    }

    if (profile.role !== "teacher") {
      window.location.replace("admin-dashboard.html");
      return;
    }

    rememberDashboard();
    const displayName = profile.full_name || "Staff Member";
    const label = profile.role === "teacher" && profile.admin_level && profile.admin_level !== "none" ? "Teacher + " + (profile.admin_level === "super_admin" ? "Super Admin" : "Admin") : roleLabel(profile.role);

    document.getElementById("staff-name").textContent = displayName;
    document.getElementById("staff-code").textContent = profile.staff_code || "—";
    document.getElementById("staff-role").textContent = label;
    document.getElementById("profile-role").textContent = label;
    document.getElementById("account-status").textContent = "Active";

    const staffManagementCard = document.getElementById("staff-management-card");
    const switchAdmin = document.getElementById("switch-admin-dashboard");
    const hasAdminAccess = ["admin", "super_admin"].includes(profile.admin_level || "none");
    const openExaminations = document.getElementById("open-examinations");
    const openStaffManagement = document.getElementById("open-staff-management");

    // Dual-role accounts keep their Teacher workspace while exposing direct links
    // to the administrative tools they are separately authorized to use.
    if (hasAdminAccess) {
      const adminLabel = profile.admin_level === "super_admin" ? "Super Admin" : "Admin";
      document.getElementById("examinations-card-description").textContent =
        "Open examination management, start or close exams, and monitor candidate activity.";
      document.getElementById("examinations-card-status").textContent = "Available";
      openExaminations.hidden = false;
      openExaminations.addEventListener("click", () => {
        window.location.assign("admin-dashboard.html?panel=examinations");
      });
      staffManagementCard.hidden = false;
      staffManagementCard.querySelector("p").textContent =
        "Open staff accounts and administrative permissions. Your access level: " + adminLabel + ".";
      openStaffManagement.addEventListener("click", () => {
        window.location.assign("admin-dashboard.html?panel=teachers");
      });
    }
    if (profile.role === "teacher" && ["admin", "super_admin"].includes(profile.admin_level || "none")) {
      switchAdmin.hidden = false;
      switchAdmin.textContent = profile.admin_level === "super_admin" ? "Switch to Super Admin Dashboard" : "Switch to Admin Dashboard";
      switchAdmin.addEventListener("click", () => window.location.assign("admin-dashboard.html"));
    }
    document.getElementById("workspace-title").textContent =
      hasAdminAccess ? "Teacher + " + (profile.admin_level === "super_admin" ? "Super Admin Workspace" : "Admin Workspace") : "Teacher Workspace";
    document.getElementById("workspace-description").textContent =
      hasAdminAccess
        ? "Your teaching workspace and the administrative tools assigned to your account are available here."
        : "Teaching and examination tools assigned to your account.";
  }

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    signOutButton.textContent = "Signing Out…";
    try {
      const { error } = await window.supabaseClient.auth.signOut({ scope: "global" });
      if (error) throw error;
      window.sessionStorage.removeItem("lbis_staff_profile");
      window.sessionStorage.removeItem("lbis_last_dashboard");
      window.location.replace("admin-login.html");
    } catch (error) {
      console.error("LBIS teacher sign-out failed:", error);
      signOutButton.disabled = false;
      signOutButton.textContent = "Sign Out";
      showMessage("Unable to sign out right now. Please try again.");
    }
  });

  // Revalidate protected pages restored from the browser's back/forward cache.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) loadDashboard().catch((error) => {
      console.error("LBIS staff session revalidation failed:", error);
      redirectToLogin();
    });
  });
  window.addEventListener("popstate", () => {
    window.supabaseClient?.auth.getSession().then(({ data, error }) => {
      if (error || !data?.session) redirectToLogin();
    }).catch(redirectToLogin);
  });

  loadDashboard().catch((error) => {
    console.error("LBIS staff dashboard initialization failed:", error);
    showMessage("The dashboard could not be loaded. Please refresh the page.");
  });
})();