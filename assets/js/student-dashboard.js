(() => {
  "use strict";

  const SUPABASE_URL = "https://mbsbfhifbsdiryerqxbq.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7UJC2JRYXUSJth87lEYq6w_xNfjdXLq";
  const tokenKey = "lbis_student_session_token";
  const expiryKey = "lbis_student_session_expires_at";
  const profileKey = "lbis_student_profile";

  const nameEl = document.getElementById("student-name");
  const classEl = document.getElementById("student-class");
  const admissionEl = document.getElementById("student-admission");
  const totalEl = document.getElementById("exam-total");
  const availableEl = document.getElementById("exam-available");
  const messageEl = document.getElementById("dashboard-message");
  const listEl = document.getElementById("examination-list");
  const refreshButton = document.getElementById("refresh-examinations");
  const logoutButton = document.getElementById("student-logout");

  function clearSession() {
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(expiryKey);
    sessionStorage.removeItem(profileKey);
  }

  function signOut() {
    clearSession();
    window.location.replace("student-login.html");
  }

  function getSession() {
    const token = sessionStorage.getItem(tokenKey);
    const expiresAt = sessionStorage.getItem(expiryKey);
    if (!token || !expiresAt || Date.parse(expiresAt) <= Date.now()) return null;
    return token;
  }

  function showMessage(text, state = "") {
    messageEl.textContent = text;
    messageEl.className = state ? `dashboard-message ${state}` : "dashboard-message";
    messageEl.hidden = !text;
  }

  function safeDate(value) {
    if (!value) return "Not specified";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not specified" : date.toLocaleString();
  }

  function statusLabel(value) {
    return ({
      available: "Available",
      resume: "In Progress",
      upcoming: "Upcoming",
      closed: "Closed",
      attempted: "Attempted",
      unavailable: "Unavailable"
    })[value] || "Unavailable";
  }

  function createExamCard(exam) {
    const card = document.createElement("article");
    card.className = "exam-card";

    const top = document.createElement("div");
    top.className = "exam-card-top";
    const title = document.createElement("h3");
    title.textContent = exam.title || "Untitled Examination";
    const state = document.createElement("span");
    state.className = `exam-state ${exam.availability || "unavailable"}`;
    state.textContent = statusLabel(exam.availability);
    top.append(title, state);

    const subject = document.createElement("p");
    subject.className = "exam-subject";
    subject.textContent = exam.subject || "Subject not specified";

    const meta = document.createElement("div");
    meta.className = "exam-meta";
    [
      `Duration: ${Number(exam.duration_minutes) || 0} minutes`,
      `Questions: ${Number(exam.question_count) || 0}`,
      `Total marks: ${Number(exam.total_marks) || 0}`
    ].forEach((value) => {
      const item = document.createElement("span");
      item.textContent = value;
      meta.appendChild(item);
    });

    const description = document.createElement("p");
    description.className = "exam-description";
    description.textContent = exam.availability_message || "";

    const schedule = document.createElement("p");
    schedule.className = "exam-description";
    schedule.textContent = `Starts: ${safeDate(exam.starts_at)} · Ends: ${safeDate(exam.ends_at)}`;

    card.append(top, subject, meta, description, schedule);

    // Examination room launch is enabled in the next implementation stage.
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = exam.availability === "resume" ? "Resume Examination" : "Start Examination";
    button.disabled = true;
    button.title = "Examination room access is being prepared.";
    button.setAttribute("aria-label", `${button.textContent}: ${exam.title || "examination"} — not yet enabled`);
    card.appendChild(button);
    return card;
  }

  async function loadDashboard() {
    const token = getSession();
    if (!token) {
      signOut();
      return;
    }

    refreshButton.disabled = true;
    refreshButton.textContent = "Loading…";
    listEl.replaceChildren();
    showMessage("Loading your examinations…");

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/student-dashboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_PUBLISHABLE_KEY,
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ action: "load_dashboard" }),
        cache: "no-store"
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        signOut();
        return;
      }
      if (!response.ok || data.success !== true) {
        throw new Error(data.message || "Unable to load your dashboard.");
      }

      const student = data.student || {};
      const assignedClass = data.class || {};
      const exams = Array.isArray(data.examinations) ? data.examinations : [];
      nameEl.textContent = student.full_name || "Student";
      classEl.textContent = assignedClass.level
        ? `${assignedClass.name} — ${assignedClass.level}`
        : (assignedClass.name || "Not assigned");
      admissionEl.textContent = student.admission_number || "—";
      totalEl.textContent = String(exams.length);
      availableEl.textContent = String(exams.filter((exam) => ["available", "resume"].includes(exam.availability)).length);

      if (!exams.length) {
        showMessage("There are currently no examinations assigned to your registered class.");
      } else {
        showMessage("");
        exams.forEach((exam) => listEl.appendChild(createExamCard(exam)));
      }
    } catch (error) {
      showMessage(error.message || "Unable to load your dashboard. Please try again.", "error");
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh";
    }
  }

  logoutButton.addEventListener("click", signOut);
  refreshButton.addEventListener("click", loadDashboard);
  loadDashboard();
})();
