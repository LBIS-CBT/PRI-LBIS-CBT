(() => {
  "use strict";

  const form = document.getElementById("student-login-form");
  if (!form) return;

  const SUPABASE_URL = "https://mbsbfhifbsdiryerqxbq.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7UJC2JRYXUSJth87lEYq6w_xNfjdXLq";

  const admission = document.getElementById("admission-number");
  const classField = document.getElementById("student-class");
  const password = document.getElementById("exam-password");
  const message = document.getElementById("student-login-message");
  const submitButton = form.querySelector('button[type="submit"]');

  function showMessage(text, type = "") {
    message.textContent = text || "";
    message.dataset.state = type;
  }

  const existingToken = sessionStorage.getItem("lbis_student_session_token");
  const existingExpiry = sessionStorage.getItem("lbis_student_session_expires_at");
  if (existingToken && existingExpiry && Date.parse(existingExpiry) > Date.now()) {
    window.location.replace("student-dashboard.html");
    return;
  }

  function clearStudentSession() {
    sessionStorage.removeItem("lbis_student_session_token");
    sessionStorage.removeItem("lbis_student_session_expires_at");
    sessionStorage.removeItem("lbis_student_profile");
  }

  // Do not reveal student existence or class before the global password is verified.
  admission.addEventListener("input", () => {
    classField.value = "";
    if (message.textContent) showMessage("");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage("");

    const admissionNumber = admission.value.trim();
    const examPassword = password.value;

    if (!admissionNumber || !examPassword) {
      showMessage("Enter your Admission Number and Examination Password.", "error");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Verifying…";
    classField.value = "";
    clearStudentSession();

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/student-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_PUBLISHABLE_KEY,
          "Authorization": `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
        },
        body: JSON.stringify({
          admission_number: admissionNumber,
          exam_password: examPassword
        }),
        cache: "no-store"
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true || !data.student_token || !data.student) {
        throw new Error(data.message || "Admission Number or Examination Password is incorrect.");
      }

      sessionStorage.setItem("lbis_student_session_token", data.student_token);
      sessionStorage.setItem("lbis_student_session_expires_at", data.expires_at);
      sessionStorage.setItem("lbis_student_profile", JSON.stringify(data.student));

      const classLabel = data.student.class_level
        ? `${data.student.class_name} — ${data.student.class_level}`
        : data.student.class_name;
      classField.value = classLabel || "";

      password.value = "";
      form.dataset.authenticated = "true";
      submitButton.textContent = "Opening Student Dashboard…";
      showMessage("Identity verified. Opening your Student Dashboard…", "success");
      window.location.replace("student-dashboard.html");
    } catch (error) {
      clearStudentSession();
      classField.value = "";
      showMessage(error.message || "Unable to sign in. Please try again.", "error");
      submitButton.disabled = false;
      submitButton.textContent = "Enter Exam Room";
    }
  });
})();