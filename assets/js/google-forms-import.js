(() => {
"use strict";

const $ = id => document.getElementById(id);
const FUNCTION_BASE = "https://mbsbfhifbsdiryerqxbq.supabase.co/functions/v1";
let extractedQuestions = [];
let selectedExamId = "";
let extractionFormUrl = "";

function setMessage(message, type = "") {
  const node = $("google-import-message");
  if (!node) return;
  node.textContent = message || "";
  node.className = "google-import-message" + (type ? " " + type : "");
}

async function callFunction(name, payload) {
  const { data, error } = await window.supabaseClient.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw new Error("Your login session has expired. Please sign in again.");

  const response = await fetch(FUNCTION_BASE + "/" + name, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": window.LBIS_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_7UJC2JRYXUSJth87lEYq6w_xNfjdXLq",
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify(payload || {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    throw new Error(result.message || "The Google Forms service could not complete the request.");
  }
  return result;
}

function normalizeResult(result) {
  const root = result?.data && typeof result.data === "object" ? result.data : result;
  const questions = Array.isArray(root?.questions) ? root.questions : [];
  const stats = root?.stats || root?.summary || root || {};
  const form = root?.form || result?.form || {};
  return { questions, stats, form };
}

function renderPreview(questions, stats, form) {
  const preview = $("google-import-preview");
  const list = $("google-import-question-list");
  const summary = $("google-import-summary");
  if (!preview || !list || !summary) return;

  list.replaceChildren();
  questions.forEach((question, index) => {
    const article = document.createElement("article");
    article.className = "google-import-question";
    const heading = document.createElement("h4");
    heading.textContent = (index + 1) + ". " + (question.question_text || "Untitled question");
    article.appendChild(heading);

    const options = document.createElement("ol");
    options.type = "A";
    (Array.isArray(question.options) ? question.options : []).forEach((option, optionIndex) => {
      const item = document.createElement("li");
      item.textContent = String(option);
      if (optionIndex === Number(question.correct_option_index)) {
        item.className = "correct-answer";
        item.append(" — Correct answer");
      }
      options.appendChild(item);
    });
    article.appendChild(options);

    const meta = document.createElement("p");
    meta.className = "google-import-question-meta";
    meta.textContent = (Number(question.marks) || 0) + " mark(s)";
    article.appendChild(meta);
    list.appendChild(article);
  });

  const title = form.title ? "Form: " + form.title + " · " : "";
  summary.textContent = title +
    questions.length + " supported question(s) · " +
    (Number(stats.total_form_items ?? questions.length)) + " total form item(s) · " +
    (Number(stats.unsupported_question_count ?? stats.unsupported_items?.length ?? 0)) +
    " unsupported · " + (Number(stats.total_marks ?? questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0))) + " total marks.";
  preview.hidden = false;
}

async function loadExamOptions() {
  const select = $("google-import-exam");
  if (!select) return;
  const previousExamId = select.value;
  select.innerHTML = '<option value="">Loading your examinations…</option>';
  try {
    const result = await callFunction("teacher-examinations", { action: "list_teacher_examinations" });
    const exams = Array.isArray(result.examinations) ? result.examinations : [];
    select.innerHTML = '<option value="">Choose an examination</option>';
    exams.forEach(exam => {
      const option = document.createElement("option");
      option.value = exam.id;
      option.textContent = (exam.title || "Untitled examination") + " — " + (exam.subject || "No subject") +
        (exam.class?.name ? " · " + exam.class.name : "");
      select.appendChild(option);
    });
    if (exams.some(exam => exam.id === previousExamId)) select.value = previousExamId;
    if (!exams.length) setMessage("No examinations found. Create an examination first.", "info");
  } catch (error) {
    select.innerHTML = '<option value="">Unable to load examinations</option>';
    setMessage(error.message, "error");
  }
}

async function extractQuestions() {
  const examId = $("google-import-exam")?.value;
  const formUrl = $("google-import-form-url")?.value.trim();
  const button = $("google-import-extract");
  if (!examId) return setMessage("Please select the examination these questions belong to.", "error");
  if (!formUrl) return setMessage("Please paste the Google Form link or Form ID.", "error");

  button.disabled = true;
  button.textContent = "Extracting questions…";
  setMessage("Connecting to Google Forms and reading the question list…");
  $("google-import-preview").hidden = true;
  $("google-import-save").disabled = true;
  extractedQuestions = [];
  selectedExamId = "";
  extractionFormUrl = "";

  try {
    const result = await callFunction("google-forms-extract", {
      exam_id: examId,
      form_url: formUrl
    });
    const normalized = normalizeResult(result);
    if (!normalized.questions.length) {
      throw new Error("No supported questions were extracted. Check the form and its question types.");
    }
    extractedQuestions = normalized.questions;
    selectedExamId = examId;
    extractionFormUrl = formUrl;
    renderPreview(normalized.questions, normalized.stats, normalized.form);
    $("google-import-save").disabled = false;
    setMessage("Extraction complete. Review every question and correct answer below before saving.", "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Extract Questions";
  }
}

async function saveQuestions() {
  if (!selectedExamId || !extractedQuestions.length) {
    return setMessage("Extract and review the questions before saving.", "error");
  }
  if (!window.confirm("Save these Google Forms questions to the selected examination? Existing Google Forms-imported questions for this examination will be synchronised. Manually added questions will be preserved.")) return;

  const button = $("google-import-save");
  button.disabled = true;
  button.textContent = "Saving questions…";
  setMessage("Saving the reviewed questions securely…");
  try {
    const result = await callFunction("google-forms-save", {
      exam_id: selectedExamId,
      form_url: extractionFormUrl
    });
    const saved = Number(result.saved_count ?? result.saved ?? extractedQuestions.length);
    setMessage((result.message || "Google Forms questions saved successfully.") +
      " Saved: " + saved + ". You can refresh My Examinations to see the updated question count.", "success");
    button.textContent = "Saved Successfully";
  } catch (error) {
    setMessage(error.message, "error");
    button.disabled = false;
    button.textContent = "Save Questions to Examination";
  }
}

function init() {
  $("google-import-extract")?.addEventListener("click", extractQuestions);
  $("google-import-save")?.addEventListener("click", saveQuestions);
  $("google-import-refresh-exams")?.addEventListener("click", loadExamOptions);
  window.addEventListener("lbis:refresh-google-import-exams", loadExamOptions);
  $("google-import-exam")?.addEventListener("change", () => {
    extractedQuestions = [];
    selectedExamId = "";
    extractionFormUrl = "";
    $("google-import-preview").hidden = true;
    $("google-import-save").disabled = true;
    setMessage("");
  });
  loadExamOptions();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
})();