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
    window.location.replace("admin-login.html");
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
      .select("id, full_name, staff_code, role, active")
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

    const displayName = profile.full_name || "Staff Member";
    const label = roleLabel(profile.role);

    document.getElementById("staff-name").textContent = displayName;
    document.getElementById("staff-code").textContent = profile.staff_code || "—";
    document.getElementById("staff-role").textContent = label;
    document.getElementById("profile-role").textContent = label;
    document.getElementById("account-status").textContent = "Active";

    const staffManagementCard = document.getElementById("staff-management-card");
    if (profile.role === "admin" || profile.role === "super_admin") {
      document.getElementById("workspace-title").textContent =
        profile.role === "super_admin" ? "Super Admin Workspace" : "Admin Workspace";
      document.getElementById("workspace-description").textContent =
        "Administrative tools assigned to your account.";
      staffManagementCard.hidden = false;
    } else {
      document.getElementById("workspace-title").textContent = "Teacher Workspace";
      document.getElementById("workspace-description").textContent =
        "Teaching and examination tools assigned to your account.";
      staffManagementCard.hidden = true;
    }
  }

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    signOutButton.textContent = "Signing Out…";

    const { error } = await window.supabaseClient.auth.signOut();
    if (error) {
      signOutButton.disabled = false;
      signOutButton.textContent = "Sign Out";
      showMessage("Unable to sign out right now. Please try again.");
      return;
    }

    window.sessionStorage.removeItem("lbis_staff_profile");
    window.location.replace("admin-login.html");
  });

  loadDashboard().catch((error) => {
    console.error("LBIS staff dashboard initialization failed:", error);
    showMessage("The dashboard could not be loaded. Please refresh the page.");
  });
})();