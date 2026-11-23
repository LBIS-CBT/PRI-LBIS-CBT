(() => {
  const form = document.getElementById("account-form");
  const accountType = document.getElementById("account-type");
  const error = document.getElementById("form-error");

  if (!form || !accountType) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.textContent = "";

    const selected = accountType.value;
    if (selected !== "student" && selected !== "admin") {
      error.textContent = "Please select Student or Admin to continue.";
      accountType.focus();
      return;
    }

    // These are the next approved stages in the login flow.
    window.location.href = selected === "student"
      ? "student-login.html"
      : "admin-login.html";
  });
})();
