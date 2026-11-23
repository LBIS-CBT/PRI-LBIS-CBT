(() => {
  const identityForm = document.getElementById("admin-identity-form");
  const passwordForm = document.getElementById("admin-password-form");
  if (!identityForm || !passwordForm) return;

  const code = document.getElementById("admin-code");
  const role = document.getElementById("admin-role");
  const identityMessage = document.getElementById("admin-identity-message");
  const passwordMessage = document.getElementById("admin-password-message");
  const roleSummary = document.getElementById("admin-role-summary");
  const password = document.getElementById("admin-password");

  identityForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    identityMessage.textContent = "";
    const adminCode = code.value.trim();
    const selectedRole = role.value;
    if (!adminCode || !selectedRole) {
      identityMessage.textContent = "Enter your Admin Code and select Teacher or Admin.";
      return;
    }
    if (!window.LBISAuth || typeof window.LBISAuth.verifyAdminCode !== "function") {
      identityMessage.textContent = "Administrator authentication is not connected yet. Your details have not been submitted.";
      return;
    }
    try {
      identityMessage.textContent = "Verifying access…";
      const result = await window.LBISAuth.verifyAdminCode({adminCode, role:selectedRole});
      if (!result || !result.success) {
        identityMessage.textContent = (result && result.message) || "The Admin Code could not be verified.";
        return;
      }
      roleSummary.textContent = selectedRole === "teacher" ? "Teacher password" : "Admin password";
      identityForm.hidden = true;
      passwordForm.hidden = false;
      password.focus();
    } catch (error) {
      identityMessage.textContent = "Unable to verify the Admin Code. Please try again.";
    }
  });

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    passwordMessage.textContent = "";
    if (!password.value) {
      passwordMessage.textContent = "Enter your password.";
      return;
    }
    if (!window.LBISAuth || typeof window.LBISAuth.adminLogin !== "function") {
      passwordMessage.textContent = "Administrator authentication is not connected yet. Your password has not been submitted.";
      return;
    }
    try {
      passwordMessage.textContent = "Signing in…";
      const result = await window.LBISAuth.adminLogin({
        adminCode: code.value.trim(),
        role: role.value,
        password: password.value
      });
      if (result && result.success && result.redirectUrl) {
        window.location.assign(result.redirectUrl);
      } else {
        passwordMessage.textContent = (result && result.message) || "Sign in could not be completed.";
      }
    } catch (error) {
      passwordMessage.textContent = "Login service is temporarily unavailable. Please try again.";
    }
  });

  document.getElementById("change-admin-identity").addEventListener("click", () => {
    passwordForm.hidden = true;
    identityForm.hidden = false;
    password.value = "";
    passwordMessage.textContent = "";
    identityMessage.textContent = "";
  });
})();