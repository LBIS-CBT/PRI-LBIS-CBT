(() => {
  "use strict";
  const API = "https://mbsbfhifbsdiryerqxbq.supabase.co/functions/v1/student-exam-room";
  const KEY = "sb_publishable_7UJC2JRYXUSJth87lEYq6w_xNfjdXLq";
  const TOKEN_KEY = "lbis_student_session_token";
  const EXPIRY_KEY = "lbis_student_session_expires_at";
  const EXAM_KEY = "lbis_active_exam_id";
  const SESSION_KEY = "lbis_active_exam_session_id";
  const $ = (id) => document.getElementById(id);
  const ui = {
    loading:$("exam-loading"), error:$("exam-error"), errorTitle:$("exam-error-title"), errorMessage:$("exam-error-message"),
    workspace:$("exam-workspace"), result:$("exam-result"), title:$("exam-title"), subject:$("exam-subject"),
    timer:$("exam-timer"), timerWrap:document.querySelector(".exam-timer-wrap"), answered:$("answered-count"),
    progress:$("progress-fill"), number:$("question-number"), marks:$("question-marks"), question:$("question-text"),
    instruction:$("question-instruction"), options:$("options-list"), save:$("save-status"),
    previous:$("previous-question"), next:$("next-question"), navigator:$("question-navigator"),
    navigatorTotal:$("navigator-total"), submit:$("submit-exam"), dialog:$("submit-dialog"),
    dialogMessage:$("submit-dialog-message"), confirm:$("confirm-submit"), cancel:$("cancel-submit"),
    exit:$("exam-exit")
  };
  let token = "";
  let examId = "";
  let sessionId = "";
  let questions = [];
  let answers = new Map();
  let currentIndex = 0;
  let deadlineMs = 0;
  let serverOffsetMs = 0;
  let timerHandle = null;
  let heartbeatHandle = null;
  let saving = Promise.resolve();
  let submitting = false;
  let finished = false;
  let lastHeartbeat = 0;

  function showError(message, title = "Unable to open examination") {
    ui.loading.hidden = true;
    ui.workspace.hidden = true;
    ui.result.hidden = true;
    ui.error.hidden = false;
    ui.errorTitle.textContent = title;
    ui.errorMessage.textContent = message;
  }
  function showSave(message, state = "") {
    ui.save.textContent = message;
    ui.save.className = state ? `question-feedback ${state}` : "question-feedback";
  }
  async function api(action, extra = {}) {
    const response = await fetch(API, {
      method:"POST",
      headers:{"Content-Type":"application/json","apikey":KEY,"Authorization":`Bearer ${token}`},
      body:JSON.stringify({action, session_id:sessionId, ...extra}),
      cache:"no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(EXPIRY_KEY);
      window.location.replace("student-login.html");
      throw new Error("Your secure student sign-in has expired. Please sign in again.");
    }
    if (!response.ok || data.success !== true) {
      const error = new Error(data.message || "The examination request could not be completed.");
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }
  function getExamId() {
    const query = new URLSearchParams(window.location.search).get("exam_id");
    return query || sessionStorage.getItem(EXAM_KEY) || "";
  }
  function serverNow() { return Date.now() + serverOffsetMs; }
  function updateClock(serverTime) {
    if (serverTime) serverOffsetMs = Date.parse(serverTime) - Date.now();
  }
  function formatTime(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0
      ? `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(remainder).padStart(2,"0")}`
      : `${String(minutes).padStart(2,"0")}:${String(remainder).padStart(2,"0")}`;
  }
  function renderTimer() {
    if (!deadlineMs || finished) return;
    const remaining = deadlineMs - serverNow();
    ui.timer.textContent = formatTime(remaining);
    ui.timerWrap.classList.toggle("warning", remaining <= 5 * 60 * 1000 && remaining > 60 * 1000);
    ui.timerWrap.classList.toggle("danger", remaining <= 60 * 1000);
    if (remaining <= 0) {
      ui.timer.textContent = "00:00";
      autoSubmit("Your examination time has ended. Submitting your saved answers.");
    }
  }
  function startClock() {
    clearInterval(timerHandle);
    renderTimer();
    timerHandle = setInterval(renderTimer, 500);
  }
  function updateProgress() {
    const count = answers.size;
    const total = questions.length;
    ui.answered.textContent = `${count} / ${total} answered`;
    ui.progress.style.width = total ? `${Math.min(100, count / total * 100)}%` : "0%";
    ui.navigatorTotal.textContent = `${total} questions`;
    [...ui.navigator.children].forEach((button, index) => {
      button.classList.toggle("answered", answers.has(questions[index].id));
      button.classList.toggle("current", index === currentIndex);
      button.setAttribute("aria-current", index === currentIndex ? "step" : "false");
    });
  }
  function renderQuestion() {
    const q = questions[currentIndex];
    if (!q) return;
    ui.number.textContent = `QUESTION ${currentIndex + 1} OF ${questions.length}`;
    ui.marks.textContent = `${Number(q.marks) || 0} ${Number(q.marks) === 1 ? "mark" : "marks"}`;
    ui.question.textContent = q.question_text || "Question text unavailable.";
    ui.instruction.textContent = q.is_required === false ? "This question is optional. Select one answer." : "Select one answer.";
    ui.options.replaceChildren();
    const choices = Array.isArray(q.options) ? q.options : [];
    choices.forEach((choice, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer-option";
      button.setAttribute("aria-pressed", answers.get(q.id) === index ? "true" : "false");
      if (answers.get(q.id) === index) button.classList.add("selected");
      const letter = document.createElement("span");
      letter.className = "option-letter";
      letter.textContent = String.fromCharCode(65 + index);
      const text = document.createElement("span");
      text.className = "option-text";
      text.textContent = typeof choice === "string" ? choice : (choice && (choice.text || choice.label || choice.value)) || String(choice ?? "");
      button.append(letter, text);
      button.addEventListener("click", () => selectAnswer(index));
      ui.options.appendChild(button);
    });
    ui.previous.disabled = currentIndex === 0;
    ui.next.textContent = currentIndex === questions.length - 1 ? "Last Question" : "Next Question";
    showSave(answers.has(q.id) ? "Answer selected. Saving status is shown here." : "Your answers are saved automatically.");
    updateProgress();
  }
  function renderNavigator() {
    ui.navigator.replaceChildren();
    questions.forEach((q, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "question-number";
      button.textContent = String(index + 1);
      button.setAttribute("aria-label", `Go to question ${index + 1}`);
      button.addEventListener("click", () => goToQuestion(index));
      ui.navigator.appendChild(button);
    });
    updateProgress();
  }
  function selectAnswer(index) {
    if (finished || submitting) return;
    const q = questions[currentIndex];
    if (!q || index < 0 || index >= (Array.isArray(q.options) ? q.options.length : 0)) return;
    answers.set(q.id, index);
    [...ui.options.children].forEach((button, i) => {
      const selected = i === index;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    updateProgress();
    showSave("Saving your answer…");
    // Serialize saves so rapid answer changes cannot arrive out of order.
    saving = saving.then(async () => {
      const result = await api("save_answer", {question_id:q.id, selected_option_index:index});
      if (currentIndex < questions.length && questions[currentIndex]?.id === q.id && answers.get(q.id) === index) {
        showSave("Answer saved successfully.", "saved");
      }
      return result;
    }).catch((error) => {
      showSave(error.message || "Answer could not be saved. Please try again.", "error");
    });
  }
  async function goToQuestion(index) {
    if (index < 0 || index >= questions.length || index === currentIndex || finished) return;
    currentIndex = index;
    renderQuestion();
    try {
      await api("set_current_question", {question_id:questions[index].id});
    } catch (error) {
      if (error.status === 409) await handleEnded(error.message);
      else showSave(error.message || "Unable to update question position.", "error");
    }
  }
  async function heartbeat() {
    if (finished || submitting || !sessionId) return;
    try {
      const data = await api("heartbeat");
      updateClock(data.server_time);
      deadlineMs = Date.parse(data.deadline_at);
      lastHeartbeat = Date.now();
      updateProgress();
    } catch (error) {
      if (error.status === 409) await handleEnded(error.message);
      else showSave("Connection interrupted. Your saved answers remain on the server; reconnecting…", "error");
    }
  }
  async function handleEnded(message) {
    if (finished) return;
    finished = true;
    clearInterval(timerHandle);
    clearInterval(heartbeatHandle);
    showError(message || "This examination session has ended.", "Examination session ended");
    ui.errorDashboard.textContent = "Return to Dashboard";
  }
  async function autoSubmit(message) {
    if (finished || submitting) return;
    submitting = true;
    ui.submit.disabled = true;
    ui.dialog.hidden = false;
    ui.dialogMessage.textContent = message;
    ui.confirm.disabled = true;
    ui.confirm.textContent = "Submitting…";
    await submitNow(true);
  }
  async function submitNow(isAutomatic = false) {
    if (finished) return;
    submitting = true;
    ui.confirm.disabled = true;
    ui.submit.disabled = true;
    ui.cancel.disabled = true;
    try {
      await saving;
      const data = await api("submit");
      finished = true;
      clearInterval(timerHandle);
      clearInterval(heartbeatHandle);
      ui.dialog.hidden = true;
      ui.workspace.hidden = true;
      ui.error.hidden = true;
      ui.result.hidden = false;
      $("result-heading").textContent = "Your examination has been submitted";
      $("result-message").textContent = isAutomatic
        ? "The examination time ended. Your saved answers were submitted automatically."
        : (data.message || "Your responses have been recorded successfully.");
      $("result-answered").textContent = `${Number(data.result?.answered_count ?? answers.size)} / ${questions.length}`;
      $("result-status").textContent = data.result?.status === "expired" ? "Time expired" : "Submitted";
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(EXAM_KEY);
    } catch (error) {
      if (error.status === 409) {
        finished = true;
        clearInterval(timerHandle);
        clearInterval(heartbeatHandle);
        ui.dialog.hidden = true;
        showError(error.message || "Your examination session has ended.", "Examination session ended");
      } else {
        submitting = false;
        ui.confirm.disabled = false;
        ui.submit.disabled = false;
        ui.cancel.disabled = false;
        ui.confirm.textContent = "Yes, Submit";
        showSave(error.message || "Submission failed. Please check your connection and try again.", "error");
        if (isAutomatic) {
          ui.dialogMessage.textContent = "Automatic submission could not reach the server. Keep this page open and retry.";
        }
      }
    }
  }
  function askSubmit() {
    if (finished || submitting) return;
    const unanswered = questions.length - answers.size;
    ui.dialogMessage.textContent = unanswered > 0
      ? `You have ${unanswered} unanswered question(s). If you submit now, you cannot change your answers. Continue?`
      : "You have answered all questions. Once submitted, you cannot change your answers.";
    ui.dialog.hidden = false;
    ui.confirm.disabled = false;
    ui.cancel.disabled = false;
    ui.confirm.textContent = "Yes, Submit";
  }
  async function initialize() {
    token = sessionStorage.getItem(TOKEN_KEY) || "";
    const expiry = sessionStorage.getItem(EXPIRY_KEY);
    examId = getExamId();
    if (!token || !expiry || Date.parse(expiry) <= Date.now()) {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(EXPIRY_KEY);
      window.location.replace("student-login.html");
      return;
    }
    if (!examId) {
      showError("No examination was selected. Please return to your student dashboard.");
      return;
    }
    sessionStorage.setItem(EXAM_KEY, examId);
    try {
      const data = await api("start_or_resume", {exam_id:examId});
      if (!data.session || !data.examination || !Array.isArray(data.questions)) {
        throw new Error("The examination service returned incomplete session information.");
      }
      sessionId = data.session.id;
      sessionStorage.setItem(SESSION_KEY, sessionId);
      questions = data.questions;
      if (!questions.length) throw new Error("There are no questions available in this examination.");
      (data.answers || []).forEach((answer) => {
        if (Number.isInteger(answer.selected_option_index)) answers.set(answer.question_id, answer.selected_option_index);
      });
      const preferred = data.session.current_question_id;
      const savedIndex = questions.findIndex((q) => q.id === preferred);
      currentIndex = savedIndex >= 0 ? savedIndex : 0;
      deadlineMs = Date.parse(data.session.deadline_at);
      updateClock(data.server_time);
      ui.title.textContent = data.examination.title || "Examination";
      ui.subject.textContent = data.examination.subject || "";
      ui.loading.hidden = true;
      ui.error.hidden = true;
      ui.workspace.hidden = false;
      renderNavigator();
      renderQuestion();
      startClock();
      heartbeatHandle = setInterval(heartbeat, 25000);
      lastHeartbeat = Date.now();
      if (deadlineMs <= serverNow()) {
        await autoSubmit("Your examination time has ended. Submitting your saved answers.");
      }
    } catch (error) {
      if (error.status === 409) showError(error.message || "This examination attempt has ended.", "Examination attempt unavailable");
      else showError(error.message || "Unable to load your examination. Please try again.");
    }
  }

  ui.previous.addEventListener("click", () => goToQuestion(currentIndex - 1));
  ui.next.addEventListener("click", () => {
    if (currentIndex < questions.length - 1) goToQuestion(currentIndex + 1);
  });
  ui.submit.addEventListener("click", askSubmit);
  ui.confirm.addEventListener("click", () => submitNow(false));
  ui.cancel.addEventListener("click", () => { if (!submitting) ui.dialog.hidden = true; });
  ui.exit.addEventListener("click", () => {
    if (finished) window.location.href = "student-dashboard.html";
    else {
      const leave = window.confirm("Your examination is still in progress. Your saved answers will remain available if you return before time expires. Leave the examination room?");
      if (leave) window.location.href = "student-dashboard.html";
    }
  });
  $("exam-error-dashboard").addEventListener("click", () => window.location.href = "student-dashboard.html");
  $("result-dashboard").addEventListener("click", () => window.location.href = "student-dashboard.html");
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !finished) heartbeat();
  });
  window.addEventListener("beforeunload", (event) => {
    if (!finished && sessionId) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  initialize();
})();