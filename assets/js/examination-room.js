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
    exit:$("exam-exit"), theoryStage:$("theory-stage"), theoryList:$("theory-question-list"), theoryHeading:$("theory-heading")
  };
  let token = "";
  let examId = "";
  let sessionId = "";
  let questions = [];
  let objectiveQuestions = [];
  let theoryQuestions = [];
  let phase = "mcq";
  let answers = new Map();
  let currentIndex = 0;
  let deadlineMs = null;
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
    const count = objectiveQuestions.filter(q => answers.has(q.id)).length;
    const total = objectiveQuestions.length;
    ui.answered.textContent = phase === "theory" ? `${total} / ${total} MCQs completed · Theory section` : `${count} / ${total} MCQs answered`;
    ui.progress.style.width = total ? `${Math.min(100, count / total * 100)}%` : "100%";
    ui.navigatorTotal.textContent = `${total} MCQs`;
    [...ui.navigator.children].forEach((button, index) => {
      const q = objectiveQuestions[index];
      button.classList.toggle("answered", answers.has(q.id));
      button.classList.toggle("current", phase === "mcq" && index === currentIndex);
      button.setAttribute("aria-current", phase === "mcq" && index === currentIndex ? "step" : "false");
    });
  }
  function renderQuestion() {
    const layout = document.querySelector(".exam-layout");
    if (phase === "theory") {
      layout.hidden = true;
      ui.theoryStage.hidden = false;
      ui.theoryHeading.textContent = "THEORY QUESTIONS";
      ui.theoryList.replaceChildren();
      theoryQuestions.forEach((q, i) => {
        const article = document.createElement("article");
        article.className = "theory-question-card";
        const top = document.createElement("div");
        top.className = "question-topline";
        const label = document.createElement("span");
        label.textContent = `THEORY QUESTION ${i + 1}`;
        const note = document.createElement("span");
        note.textContent = "Answer on paper";
        top.append(label, note);
        const heading = document.createElement("h3");
        heading.textContent = q.question_text || "Question text unavailable.";
        const instruction = document.createElement("p");
        instruction.textContent = "Write your answer on the examination paper. No answer is required in the CBT.";
        article.append(top, heading, instruction);
        ui.theoryList.appendChild(article);
      });
      ui.submit.disabled = false;
      showSave("All objective MCQs are complete. Answer the theory questions on paper, then submit your examination.");
      updateProgress();
      return;
    }
    layout.hidden = false;
    ui.theoryStage.hidden = true;
    const q = objectiveQuestions[currentIndex];
    if (!q) return;
    ui.number.textContent = `MCQ ${currentIndex + 1} OF ${objectiveQuestions.length}`;
    ui.marks.textContent = `${Number(q.marks) || 0} ${Number(q.marks) === 1 ? "mark" : "marks"}`;
    ui.question.textContent = q.question_text || "Question text unavailable.";
    ui.instruction.textContent = "Select one answer. All objective questions must be answered.";
    ui.options.replaceChildren();
    (q.options || []).forEach((choice, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer-option";
      button.setAttribute("aria-pressed", answers.get(q.id) === index ? "true" : "false");
      if (answers.get(q.id) === index) button.classList.add("selected");
      const letter = document.createElement("span");
      letter.className = "option-letter";
      letter.textContent = String.fromCharCode(65 + index);
      const value = document.createElement("span");
      value.className = "option-text";
      value.textContent = typeof choice === "string" ? choice : (choice && (choice.text || choice.label || choice.value)) || String(choice ?? "");
      button.append(letter, value);
      button.addEventListener("click", () => selectAnswer(index));
      ui.options.appendChild(button);
    });
    ui.previous.disabled = currentIndex === 0;
    ui.next.textContent = currentIndex === objectiveQuestions.length - 1 ? (theoryQuestions.length ? "Continue to Theory" : "Finish MCQs") : "Next Question";
    ui.submit.disabled = true;
    updateProgress();
    showSave(answers.has(q.id) ? "Answer selected. Saving status is shown here." : "Your answers are saved automatically.");
  }
  function renderNavigator() {
    ui.navigator.replaceChildren();
    objectiveQuestions.forEach((q, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "question-number";
      button.textContent = String(index + 1);
      button.setAttribute("aria-label", `Go to MCQ ${index + 1}`);
      button.addEventListener("click", () => goToQuestion(index));
      ui.navigator.appendChild(button);
    });
    updateProgress();
  }
  function selectAnswer(index) {
    if (finished || submitting) return;
    if (phase !== "mcq") return;
    const q = objectiveQuestions[currentIndex];
    if (!q || !Array.isArray(q.options) || q.options.length <= 1 || index < 0 || index >= q.options.length) return;
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
      if (phase === "mcq" && currentIndex < objectiveQuestions.length && objectiveQuestions[currentIndex]?.id === q.id && answers.get(q.id) === index) {
        showSave("Answer saved successfully.", "saved");
      }
      return result;
    }).catch((error) => {
      showSave(error.message || "Answer could not be saved. Please try again.", "error");
    });
  }
  async function goToQuestion(index) {
    if (phase !== "mcq" || index < 0 || index >= objectiveQuestions.length || index === currentIndex || finished) return;
    currentIndex = index;
    renderQuestion();
    try {
      await api("set_current_question", {question_id:objectiveQuestions[index].id});
    } catch (error) {
      if (error.status === 409) await handleEnded(error.message);
      else showSave(error.message || "Unable to update question position.", "error");
    }
  }
  async function continueFromMcq() {
    const unanswered = objectiveQuestions.filter(q => !answers.has(q.id)).length;
    if (unanswered > 0) {
      showSave(`Please answer all objective MCQs first. ${unanswered} question(s) remain unanswered.`, "error");
      return;
    }
    await saving;
    phase = "theory";
    renderQuestion();
  }
  async function heartbeat() {
    if (finished || submitting || !sessionId) return;
    try {
      const data = await api("heartbeat");
      updateClock(data.server_time);
      deadlineMs = data.deadline_at ? Date.parse(data.deadline_at) : null;
      lastHeartbeat = Date.now();
      updateProgress();
    } catch (error) {
      if (error.status === 409) await handleEnded(error.message);
      else showSave("Connection interrupted. Your saved answers remain on the server; reconnecting…", "error");
    }
  }
  function showCompleted(message, status = "Submitted") {
    finished = true;
    submitting = false;
    clearInterval(timerHandle);
    clearInterval(heartbeatHandle);
    ui.dialog.hidden = true;
    ui.workspace.hidden = true;
    ui.error.hidden = true;
    ui.result.hidden = false;
    $("result-heading").textContent = "Your examination has been completed";
    $("result-message").textContent = message || "Your saved responses have been recorded.";
    $("result-answered").textContent = `${answers.size} / ${questions.length}`;
    $("result-status").textContent = status;
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(EXAM_KEY);
  }
  async function handleEnded(message) {
    if (finished) return;
    showCompleted(message || "Your examination session has ended. Your saved responses have been recorded.", "Time ended");
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
        showCompleted(error.message || "Your examination time has ended. Your saved answers have been submitted.", error.data?.attempt_status === "expired" ? "Time expired" : "Completed");
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
    if (finished || submitting || phase !== "theory") return;
    const unanswered = objectiveQuestions.filter(q => !answers.has(q.id)).length;
    if (unanswered > 0) {
      showSave(`You still have ${unanswered} unanswered objective MCQ(s). Complete them before submitting.`, "error");
      return;
    }
    ui.dialogMessage.textContent = theoryQuestions.length
      ? "Have you completed writing all the theory answers on your examination paper? Once submitted, you cannot return to this examination."
      : "You have answered all objective questions. Once submitted, you cannot change your answers.";
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
      objectiveQuestions = questions.filter(q => Array.isArray(q.options) && q.options.length > 1);
      theoryQuestions = questions.filter(q => Array.isArray(q.options) && q.options.length === 1);
      (data.answers || []).forEach((answer) => {
        const question = questions.find(q => q.id === answer.question_id);
        if (question && Array.isArray(question.options) && question.options.length > 1 && Number.isInteger(answer.selected_option_index)) answers.set(answer.question_id, answer.selected_option_index);
      });
      const preferred = data.session.current_question_id;
      const savedIndex = objectiveQuestions.findIndex(q => q.id === preferred);
      currentIndex = savedIndex >= 0 ? savedIndex : 0;
      const allMcqsAnswered = objectiveQuestions.every(q => answers.has(q.id));
      phase = (objectiveQuestions.length === 0 || allMcqsAnswered) && theoryQuestions.length > 0 ? "theory" : "mcq";
      deadlineMs = data.session.deadline_at ? Date.parse(data.session.deadline_at) : null;
      updateClock(data.server_time);
      const candidateName = document.getElementById("candidate-full-name");
      const candidateAdmission = document.getElementById("candidate-admission-number");
      if (candidateName) candidateName.textContent = data.candidate?.full_name || "Not available — contact the school office";
      if (candidateAdmission) candidateAdmission.textContent = data.candidate?.admission_number || "Not available — contact the school office";
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
      if (deadlineMs !== null && deadlineMs <= serverNow()) {
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