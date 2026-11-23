(() => {
  const form = document.getElementById("student-login-form");
  if (!form) return;

  const admission = document.getElementById("admission-number");
  const classField = document.getElementById("student-class");
  const password = document.getElementById("exam-password");
  const message = document.getElementById("student-login-message");
  let lookupTimer;

  async function lookupStudent() {
    const admissionNumber = admission.value.trim();
    classField.value = "";
    if (!admissionNumber) return;
    message.textContent = "Looking up student record…";

    try {
      if (!window.LBISAuth || typeof window.LBISAuth.lookupStudent !== "function") {
        message.textContent = "Student account service is not connected yet.";
        return;
      }
      const student = await window.LBISAuth.lookupStudent(admissionNumber);
      if (!student || !student.className) {
        message.textContent = "No matching student record was found. Check the Admission Number.";
        return;
      }
      classField.value = student.className;
      message.textContent = "";
    } catch (error) {
      message.textContent = "Unable to retrieve your class at the moment. Please try again.";
    }
  }

  admission.addEventListener("change", lookupStudent);
  admission.addEventListener("blur", lookupStudent);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    const admissionNumber = admission.value.trim();
    if (!admissionNumber || !password.value) {
      message.textContent = "Enter your Admission Number and Examination Password.";
      return;
    }
    if (!classField.value) {
      await lookupStudent();
      if (!classField.value) return;
    }
    if (!window.LBISAuth || typeof window.LBISAuth.studentLogin !== "function") {
      message.textContent = "Student authentication is not connected yet. Your details have not been submitted.";
      return;
    }
    try {
      message.textContent = "Verifying…";
      const result = await window.LBISAuth.studentLogin({
        admissionNumber,
        examPassword: password.value
      });
      if (result && result.success && result.redirectUrl) {
        window.location.assign(result.redirectUrl);
      } else {
        message.textContent = (result && result.message) || "Login could not be completed.";
      }
    } catch (error) {
      message.textContent = "Login service is temporarily unavailable. Please try again.";
    }
  });
})();