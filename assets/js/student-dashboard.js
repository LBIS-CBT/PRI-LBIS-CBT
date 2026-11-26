(() => {
  "use strict";
  const SUPABASE_URL = "https://mbsbfhifbsdiryerqxbq.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_7UJC2JRYXUSJth87lEYq6w_xNfjdXLq";
  const tokenKey = "lbis_student_session_token";
  const expiryKey = "lbis_student_session_expires_at";
  const profileKey = "lbis_student_profile";
  const activeExamKey = "lbis_active_exam_id";

  const nameEl = document.getElementById("student-name");
  const classEl = document.getElementById("student-class");
  const admissionEl = document.getElementById("student-admission");
  const totalEl = document.getElementById("exam-total");
  const availableEl = document.getElementById("exam-available");
  const messageEl = document.getElementById("dashboard-message");
  const listEl = document.getElementById("examination-list");
  const refreshButton = document.getElementById("refresh-examinations");
  const logoutButton = document.getElementById("student-logout");
  const resultsButton=document.getElementById("student-results-button");const resultsSection=document.getElementById("student-results-section");const resultsMessage=document.getElementById("student-results-message");const resultsList=document.getElementById("student-results-list");const resultsRefresh=document.getElementById("student-results-refresh");let releasedResults=[];

  function clearSession() {
    [tokenKey, expiryKey, profileKey, activeExamKey, "lbis_active_exam_session_id"]
      .forEach((key) => sessionStorage.removeItem(key));
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
    return ({available:"Available",resume:"In Progress",retake_available:"Retake Approved",retake_waiting:"Retake Approved",upcoming:"Upcoming",closed:"Closed",attempted:"Attempted",unavailable:"Unavailable"})[value] || "Unavailable";
  }
  async function openExam(exam, button) {
    const token = getSession();
    if (!token) { signOut(); return; }
    button.disabled = true;
    const original = button.textContent;
    button.textContent = exam.availability === "resume" ? "Resuming…" : (exam.availability === "retake_available" ? "Starting retake…" : "Preparing…");
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/student-exam-room`, {
        method: "POST",
        headers: {
          "Content-Type":"application/json",
          "apikey":SUPABASE_PUBLISHABLE_KEY,
          "Authorization":`Bearer ${token}`
        },
        body: JSON.stringify({action:"start_or_resume", exam_id:exam.id}),
        cache:"no-store"
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { signOut(); return; }
      if (!response.ok || data.success !== true || !data.session || !data.examination) {
        throw new Error(data.message || "Unable to open this examination.");
      }
      sessionStorage.setItem(activeExamKey, exam.id);
      sessionStorage.setItem("lbis_active_exam_session_id", data.session.id);
      window.location.href = `examination-room.html?exam_id=${encodeURIComponent(exam.id)}`;
    } catch (error) {
      showMessage(error.message || "Unable to open the examination. Please try again.", "error");
      button.disabled = false;
      button.textContent = original;
    }
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
      `Total marks: ${Number(exam.total_marks) || 0}`,
      `Attempts used: ${Number(exam.attempts_count) || 0}`
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
    if (exam.attempts_count > 0) {
      const history = document.createElement("p");
      history.className = "exam-description";
      const latest = Array.isArray(exam.attempts) ? exam.attempts[0] : null;
      history.textContent = latest
        ? `Latest attempt: #${latest.attempt_number || 1} · ${String(latest.status || "ended").replaceAll("_", " ")}`
        : `Previous attempts: ${exam.attempts_count}`;
      card.appendChild(history);
    }
    if (exam.retake_authorization?.reason && exam.availability === "retake_available") {
      const approval = document.createElement("p");
      approval.className = "exam-description";
      approval.textContent = "School approval: " + exam.retake_authorization.reason;
      card.appendChild(approval);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = exam.availability === "resume" ? "Resume Examination" : (exam.availability === "retake_available" ? "Start Authorised Retake" : "Start Examination");
    const canStart = ["available", "resume", "retake_available"].includes(exam.availability) && !!exam.id;
    button.disabled = !canStart;
    button.title = canStart ? "" : "This examination is not currently available.";
    button.setAttribute("aria-label", `${button.textContent}: ${exam.title || "examination"}`);
    if (canStart) button.addEventListener("click", () => openExam(exam, button));
    card.appendChild(button);
    return card;
  }
  function renderStudentResults(){resultsList.replaceChildren();if(!releasedResults.length){resultsMessage.textContent="No results have been released by the school yet. Please check again later.";resultsMessage.hidden=false;return;}resultsMessage.textContent="The following subject results have been officially released by the school.";resultsMessage.hidden=false;releasedResults.forEach(result=>{const card=document.createElement("article");card.className="student-result-card";const head=document.createElement("div");head.className="student-result-card-head";const title=document.createElement("h3");title.textContent=result.subject||result.title||"Examination";const status=document.createElement("span");status.className="student-result-published";status.textContent="PUBLISHED";head.append(title,status);const exam=document.createElement("p");exam.textContent=result.title||"";const stats=document.createElement("div");stats.className="student-result-stats";[["Score",String(result.score)+" / "+String(result.total_marks)],["Percentage",result.percentage==null?"—":Number(result.percentage).toFixed(1)+"%"],["Attempt","Attempt "+result.attempt_number]].forEach(([label,value])=>{const item=document.createElement("div"),small=document.createElement("span"),strong=document.createElement("strong");small.textContent=label;strong.textContent=value;item.append(small,strong);stats.append(item);});const submitted=document.createElement("p");submitted.className="student-result-date";submitted.textContent="Submitted: "+safeDate(result.submitted_at);card.append(head,exam,stats,submitted);resultsList.appendChild(card);});}
  async function loadStudentResults(){const token=getSession();if(!token){signOut();return;}resultsRefresh.disabled=true;resultsRefresh.textContent="Loading…";try{const response=await fetch(`${SUPABASE_URL}/functions/v1/student-dashboard`,{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":`Bearer ${token}`},body:JSON.stringify({action:"load_dashboard"}),cache:"no-store"});const data=await response.json().catch(()=>({}));if(response.status===401){signOut();return;}if(!response.ok||data.success!==true)throw new Error(data.message||"Results could not be loaded.");releasedResults=Array.isArray(data.released_results)?data.released_results:[];renderStudentResults();}catch(error){resultsMessage.textContent=error.message||"Unable to load results.";resultsMessage.className="dashboard-message error";}finally{resultsRefresh.disabled=false;resultsRefresh.textContent="Refresh Results";}}
  async function loadDashboard() {
    const token = getSession();
    if (!token) { signOut(); return; }
    refreshButton.disabled = true;
    refreshButton.textContent = "Loading…";
    listEl.replaceChildren();
    showMessage("Loading your examinations…");
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/student-dashboard`, {
        method:"POST",
        headers:{"Content-Type":"application/json","apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":`Bearer ${token}`},
        body:JSON.stringify({action:"load_dashboard"}),
        cache:"no-store"
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { signOut(); return; }
      if (!response.ok || data.success !== true) throw new Error(data.message || "Unable to load your dashboard.");
      const student = data.student || {};
      const assignedClass = data.class || {};
      const exams = Array.isArray(data.examinations) ? data.examinations : [];
      nameEl.textContent = student.full_name || "Student";
      classEl.textContent = assignedClass.level ? `${assignedClass.name} — ${assignedClass.level}` : (assignedClass.name || "Not assigned");
      admissionEl.textContent = student.admission_number || "—";
      totalEl.textContent = String(exams.length);
      availableEl.textContent = String(exams.filter((exam) => ["available","resume"].includes(exam.availability)).length);
      if (!exams.length) showMessage("There are currently no examinations assigned to your registered class.");
      else { showMessage(""); exams.forEach((exam) => listEl.appendChild(createExamCard(exam))); }
    } catch (error) {
      showMessage(error.message || "Unable to load your dashboard. Please try again.", "error");
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh";
    }
  }
  resultsButton.addEventListener("click",()=>{resultsSection.hidden=!resultsSection.hidden;if(!resultsSection.hidden){resultsSection.scrollIntoView({behavior:"smooth",block:"start"});loadStudentResults();}});resultsRefresh.addEventListener("click",loadStudentResults);
  logoutButton.addEventListener("click", signOut);
  refreshButton.addEventListener("click", loadDashboard);
  loadDashboard();
})();