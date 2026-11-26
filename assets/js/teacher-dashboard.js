(() => {
"use strict";

const $ = id => document.getElementById(id);
const layout = $("teacher-layout");
const unsupported = $("unsupported-device");
const message = $("teacher-dashboard-message");
if (!layout) return;

if (window.matchMedia("(max-width: 600px)").matches) {
  unsupported.hidden = false;
  return;
}

const FUNCTION_URL = "https://mbsbfhifbsdiryerqxbq.supabase.co/functions/v1/teacher-examinations";
let currentTeacher = null;
let classesLoaded = false;

const say = text => { if (message) message.textContent = text || ""; };
const roleNames = { teacher: "Teacher", admin: "Administrator", super_admin: "Super Administrator" };

function showPanel(name) {
  document.querySelectorAll(".teacher-panel").forEach(panel =>
    panel.classList.toggle("active", panel.id === "teacher-panel-" + name)
  );
  document.querySelectorAll(".teacher-nav-button").forEach(button =>
    button.classList.toggle("active", button.dataset.panel === name)
  );
  const titles = {
    overview: "Teacher Overview",
    "create-exam": "Create Examination",
    "my-exams": "My Examinations",
    "question-bank": "Question Extraction",
    "results": "My Examination Results"
  };
  $("teacher-page-title").textContent = titles[name] || "Teacher Dashboard";
  say("");
  if (name === "create-exam") loadClasses();
  if (name === "my-exams") loadExaminations();
  if (name === "results") loadTeacherResultsExams();
  if (name === "question-bank") {
    loadGoogleConnectionStatus();
    window.dispatchEvent(new Event("lbis:refresh-google-import-exams"));
  }
}

async function callTeacherService(payload) {
  const { data: sessionData, error: sessionError } = await window.supabaseClient.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    throw new Error("Your login session has expired. Please sign in again.");
  }

  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": window.LBIS_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_7UJC2JRYXUSJth87lEYq6w_xNfjdXLq",
      "Authorization": "Bearer " + sessionData.session.access_token
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(result.message || "The examination service could not complete the request.");
  }
  return result;
}


const GOOGLE_FUNCTION_BASE = "https://mbsbfhifbsdiryerqxbq.supabase.co/functions/v1";

async function callGoogleFunction(functionName, payload = {}) {
  const { data: sessionData, error: sessionError } =
    await window.supabaseClient.auth.getSession();

  if (sessionError || !sessionData?.session?.access_token) {
    throw new Error("Your login session has expired. Please sign in again.");
  }

  const response = await fetch(GOOGLE_FUNCTION_BASE + "/" + functionName, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": window.LBIS_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_7UJC2JRYXUSJth87lEYq6w_xNfjdXLq",
      "Authorization": "Bearer " + sessionData.session.access_token
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.success === false) {
    throw new Error(result.message || "The Google connection service could not complete the request.");
  }

  return result;
}

function setGoogleConnectionView(connected, email) {
  const badge = $("google-connection-badge");
  const connectedDetails = $("google-connected-details");
  const notConnectedDetails = $("google-not-connected-details");

  if (badge) {
    badge.textContent = connected ? "Connected" : "Not connected";
    badge.className = "google-connection-badge " + (connected ? "connected" : "not-connected");
  }

  if (connectedDetails) connectedDetails.hidden = !connected;
  if (notConnectedDetails) notConnectedDetails.hidden = connected;

  const emailElement = $("google-account-email");
  if (emailElement) emailElement.textContent = email || "Google account";
}

async function loadGoogleConnectionStatus() {
  const badge = $("google-connection-badge");
  const feedback = $("google-connection-message");
  if (!badge) return;

  badge.textContent = "Checking connection…";
  badge.className = "google-connection-badge checking";
  if (feedback && !feedback.dataset.callbackNotice) feedback.textContent = "";

  try {
    const result = await callGoogleFunction("google-connection-status", {
      action: "status"
    });

    setGoogleConnectionView(result.connected === true, result.google_email || "");
    if (feedback && !feedback.dataset.callbackNotice) {
      feedback.textContent = result.connected
        ? "Your Google account is ready for the next extraction step."
        : "Connect a Google account to continue.";
    }
  } catch (error) {
    badge.textContent = "Status unavailable";
    badge.className = "google-connection-badge not-connected";
    if (feedback) feedback.textContent = error.message;
  }
}

async function connectGoogleAccount() {
  const button = $("google-connect-button");
  const feedback = $("google-connection-message");
  if (!button) return;

  button.disabled = true;
  button.textContent = "Opening Google…";
  if (feedback) feedback.textContent = "";

  try {
    const result = await callGoogleFunction("google-oauth-start", {});
    if (!result.authorization_url) {
      throw new Error("The Google authorization link was not returned. Please try again.");
    }

    window.location.assign(result.authorization_url);
  } catch (error) {
    if (feedback) feedback.textContent = error.message;
    button.disabled = false;
    button.textContent = "Connect Google Account";
  }
}

async function disconnectGoogleAccount() {
  const button = $("google-disconnect-button");
  const feedback = $("google-connection-message");
  if (!button) return;

  if (!window.confirm("Disconnect this Google account from LBIS CBT?")) return;

  button.disabled = true;
  button.textContent = "Disconnecting…";
  if (feedback) feedback.textContent = "";

  try {
    const result = await callGoogleFunction("google-connection-status", {
      action: "disconnect"
    });

    setGoogleConnectionView(false, "");
    if (feedback) {
      feedback.textContent = result.google_revocation_confirmed
        ? "Google account disconnected and authorization revoked."
        : "The connection was removed from LBIS CBT. Google did not confirm revocation; you can also remove LBIS CBT access in your Google Account security settings.";
    }
  } catch (error) {
    if (feedback) feedback.textContent = error.message;
    button.disabled = false;
    button.textContent = "Disconnect";
  }
}

function handleGoogleCallbackNotice() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("google_connection");
  if (!status) return;

  const feedback = $("google-connection-message");
  if (status === "success") {
    if (feedback) {
      feedback.textContent = "Google account connected successfully.";
      feedback.dataset.callbackNotice = "true";
    }
  } else {
    const reason = params.get("reason");
    const messages = {
      authorization_denied: "Google authorization was cancelled or denied.",
      invalid_callback: "The Google authorization response was incomplete. Please try again.",
      state_validation_failed: "We could not validate the Google sign-in request. Please try again.",
      invalid_or_expired_state: "This Google sign-in request has expired. Please connect again.",
      state_already_used: "This Google sign-in request has already been used. Please connect again.",
      token_exchange_failed: "Google could not complete authorization. Please try again.",
      missing_access_token: "Google did not return the required access permission.",
      google_identity_failed: "We could not verify the selected Google account.",
      connection_lookup_failed: "We could not check the existing Google connection.",
      refresh_token_missing: "Google did not provide a refresh token. Please reconnect and approve the requested access.",
      connection_save_failed: "The Google account was verified, but its connection could not be saved.",
      server_error: "A server error interrupted Google account connection."
    };

    if (feedback) {
      feedback.textContent = messages[reason] || "Google account connection could not be completed. Please try again.";
      feedback.dataset.callbackNotice = "true";
    }
  }

  window.history.replaceState(
    {},
    document.title,
    window.location.pathname + window.location.hash
  );
}

async function loadClasses(force = false) {
  const select = $("exam-class");
  if (!select || (classesLoaded && !force)) return;
  select.innerHTML = '<option value="">Loading classes…</option>';
  try {
    const result = await callTeacherService({ action: "list_classes" });
    const classes = Array.isArray(result.classes) ? result.classes : [];
    select.innerHTML = '<option value="">Select a class</option>';
    classes.forEach(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.level ? item.name + " (" + item.level + ")" : item.name;
      select.appendChild(option);
    });
    classesLoaded = true;
    if (!classes.length) {
      select.innerHTML = '<option value="">No active classes available</option>';
    }
  } catch (error) {
    select.innerHTML = '<option value="">Unable to load classes</option>';
    $("teacher-create-message").textContent = error.message;
    $("teacher-create-message").classList.remove("success");
  }
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function loadExaminations() {
  const tbody = $("teacher-exams-body");
  const summary = $("teacher-exams-summary");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="teacher-table-empty">Loading your examinations…</td></tr>';
  if (summary) summary.textContent = "";
  try {
    const result = await callTeacherService({ action: "list_teacher_examinations" });
    const exams = Array.isArray(result.examinations) ? result.examinations : [];
    $("teacher-exam-count").textContent = String(result.total ?? exams.length);

    if (!exams.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="teacher-table-empty">You have not created any examinations yet. Use Create Examination to get started.</td></tr>';
    } else {
      tbody.innerHTML = exams.map(exam => {
        const className = exam.class ? (exam.class.name + (exam.class.level ? " (" + exam.class.level + ")" : "")) : "Class unavailable";
        const status = String(exam.status || "draft").toLowerCase();
        return '<tr>' +
          '<td><strong>' + escapeHtml(exam.title) + '</strong></td>' +
          '<td>' + escapeHtml(exam.subject) + '</td>' +
          '<td>' + escapeHtml(className) + '</td>' +
          '<td>' + escapeHtml(exam.duration_minutes) + ' mins</td>' +
          '<td>' + escapeHtml(exam.extracted_question_count ?? 0) + '</td>' +
          '<td><span class="teacher-status-pill ' + escapeHtml(status) + '">' + escapeHtml(status.replace(/_/g, " ")) + '</span></td>' +
          '<td>' + escapeHtml(formatDate(exam.created_at)) + '</td>' +
          '<td><button type="button" class="teacher-delete-exam-button" data-delete-exam="' + escapeHtml(exam.id) + '" data-exam-title="' + escapeHtml(exam.title) + '">Delete</button></td>' +
          '</tr>';
      }).join("");
    }
    if (summary) summary.textContent = exams.length + " examination(s) found. The list is limited to your own examinations.";
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="8" class="teacher-table-empty error">' + escapeHtml(error.message) + '</td></tr>';
    $("teacher-exam-count").textContent = "—";
  }
}

async function deleteExamination(examId, examTitle, button) {
  if (!examId || !button) return;
  const confirmed = window.confirm(
    'Delete "' + examTitle + '"?\n\nThis permanently removes this examination and its imported questions. It is allowed only when no candidate has ever started an attempt. Examinations with candidate sessions or results are protected.\n\nThis action cannot be undone.'
  );
  if (!confirmed) return;

  const row = button.closest("tr");
  button.disabled = true;
  button.textContent = "Deleting…";
  try {
    const result = await callTeacherService({
      action: "delete_examination",
      exam_id: examId,
      confirmation: "DELETE"
    });
    if (row) row.remove();
    say(result.message || "Examination deleted successfully.");
    await loadExaminations();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Delete";
    say(error.message || "The examination could not be deleted.");
  }
}

async function createExamination(event) {
  event.preventDefault();
  const form = $("teacher-create-exam-form");
  const button = $("teacher-create-submit");
  const feedback = $("teacher-create-message");
  if (!form.reportValidity()) return;

  const startsValue = $("exam-starts-at").value;
  const endsValue = $("exam-ends-at").value;
  const startsAt = startsValue ? new Date(startsValue) : null;
  const endsAt = endsValue ? new Date(endsValue) : null;

  if (startsAt && endsAt && endsAt <= startsAt) {
    feedback.textContent = "The scheduled end must be later than the scheduled start.";
    feedback.classList.remove("success");
    return;
  }

  button.disabled = true;
  button.textContent = "Saving Examination…";
  feedback.textContent = "";
  feedback.classList.remove("success");

  try {
    const payload = {
      action: "create_examination",
      title: $("exam-title").value,
      subject: $("exam-subject").value,
      class_id: $("exam-class").value,
      duration_minutes: Number($("exam-duration").value),
      starts_at: startsAt ? startsAt.toISOString() : null,
      ends_at: endsAt ? endsAt.toISOString() : null
    };
    const result = await callTeacherService(payload);
    feedback.textContent = result.message || "Examination created successfully and is ready for question extraction.";
    feedback.classList.add("success");
    form.reset();
    $("exam-duration").value = "60";
    await loadExaminations();
    window.dispatchEvent(new Event("lbis:refresh-google-import-exams"));
    const exam = result.examination;
    if (exam?.id) {
      showPanel("my-exams");
    }
  } catch (error) {
    feedback.textContent = error.message;
    feedback.classList.remove("success");
  } finally {
    button.disabled = false;
    button.textContent = "Save Examination";
  }
}

document.querySelectorAll("[data-panel]").forEach(button =>
  button.addEventListener("click", () => showPanel(button.dataset.panel))
);
document.querySelectorAll("[data-open-panel]").forEach(button =>
  button.addEventListener("click", () => showPanel(button.dataset.openPanel))
);

$("teacher-create-exam-form")?.addEventListener("submit", createExamination);
$("google-connect-button")?.addEventListener("click", connectGoogleAccount);
$("google-disconnect-button")?.addEventListener("click", disconnectGoogleAccount);
$("teacher-refresh-exams")?.addEventListener("click", loadExaminations);
$("teacher-exams-body")?.addEventListener("click", event => {
  const button = event.target.closest("[data-delete-exam]");
  if (!button) return;
  deleteExamination(button.dataset.deleteExam, button.dataset.examTitle || "this examination", button);
});

// Teacher Results panel — the Edge Function enforces created_by teacher scope
const TEACHER_RESULTS_URL="https://mbsbfhifbsdiryerqxbq.supabase.co/functions/v1/teacher-results";
let teacherResultRows=[];
async function callTeacherResults(payload){const {data:s,error}=await window.supabaseClient.auth.getSession();if(error||!s?.session?.access_token)throw Error("Your session has expired. Sign in again.");const response=await fetch(TEACHER_RESULTS_URL,{method:"POST",headers:{"Content-Type":"application/json","apikey":window.LBIS_SUPABASE_PUBLISHABLE_KEY||"sb_publishable_7UJC2JRYXUSJth87lEYq6w_xNfjdXLq","Authorization":"Bearer "+s.session.access_token},body:JSON.stringify(payload)});const data=await response.json().catch(()=>({}));if(!response.ok||!data.success)throw Error(data.message||"Results could not be loaded.");return data;}
function teacherScore(v){return v==null?"—":Number(v).toLocaleString(undefined,{maximumFractionDigits:2});}
function teacherResultsEmpty(text){const b=$("teacher-results-body");b.innerHTML='<tr><td colspan="8" class="teacher-table-empty"></td></tr>';b.querySelector("td").textContent=text;}
async function loadTeacherResultsExams(){const select=$("teacher-results-exam"),previous=select.value;$("teacher-results-refresh").disabled=true;try{const data=await callTeacherResults({action:"list_exams"});select.replaceChildren(new Option("Select examination",""));(data.examinations||[]).forEach(e=>select.add(new Option([e.title,e.subject,e.class_name].filter(Boolean).join(" • "),e.id)));if((data.examinations||[]).some(e=>e.id===previous))select.value=previous;if(select.value)await loadTeacherResultRows(select.value);else teacherResultsEmpty("Select one of your examinations.");}catch(e){teacherResultsEmpty(e.message);say(e.message);}finally{$("teacher-results-refresh").disabled=false;}}
async function loadTeacherResultRows(id){if(!id)return;teacherResultsEmpty("Loading results…");try{const d=await callTeacherResults({action:"list_results",exam_id:id});teacherResultRows=d.results||[];renderTeacherResults();}catch(e){teacherResultRows=[];teacherResultsEmpty(e.message);say(e.message);}}
function renderTeacherResults(){const q=$("teacher-results-search").value.trim().toLowerCase(),mode=$("teacher-results-attempts").value;let rows=teacherResultRows.filter(r=>!q||[r.student?.full_name,r.student?.admission_number].some(v=>String(v||"").toLowerCase().includes(q)));if(mode==="latest")rows=rows.filter(r=>r.is_latest);const submitted=rows.filter(r=>r.status==="submitted"),scores=submitted.map(r=>Number(r.score||0));$("teacher-results-total").textContent=String(rows.length);$("teacher-results-submitted").textContent=String(submitted.length);$("teacher-results-average").textContent=scores.length?(scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1):"—";$("teacher-results-highest").textContent=scores.length?Math.max(...scores).toLocaleString(undefined,{maximumFractionDigits:2}):"—";$("teacher-results-summary").textContent=rows.length+" result record(s) shown";const body=$("teacher-results-body");body.replaceChildren();if(!rows.length){teacherResultsEmpty(teacherResultRows.length?"No search matches.":"No attempts recorded.");return;}rows.forEach(r=>{const tr=document.createElement("tr");[r.student?.full_name||"—",r.student?.admission_number||"—",r.class_name||"—","Attempt "+r.attempt_number,teacherScore(r.score),r.status,r.submitted_at?new Date(r.submitted_at).toLocaleString():"—"].forEach((v,i)=>{const td=document.createElement("td");td.textContent=v;if(i===5){const p=document.createElement("span");p.className="teacher-status-pill "+v;p.textContent=String(v).replace(/_/g," ");td.replaceChildren(p);}tr.appendChild(td);});const td=document.createElement("td"),btn=document.createElement("button");btn.type="button";btn.className="teacher-secondary-button";btn.textContent="View";btn.addEventListener("click",()=>showTeacherResult(r));td.appendChild(btn);tr.appendChild(td);body.appendChild(tr);});}
function showTeacherResult(r){const s=r.student||{},e=r.examination||{};$("teacher-result-name").textContent=s.full_name||"Candidate";$("teacher-result-subtitle").textContent=[s.admission_number,e.title,e.subject,r.class_name,"Attempt "+r.attempt_number].filter(Boolean).join(" • ");const out=$("teacher-result-detail");out.replaceChildren();const strip=document.createElement("div");strip.className="teacher-result-score-strip";[["Score",teacherScore(r.score)],["Percentage",r.percentage==null?"—":Number(r.percentage).toFixed(1)+"%"],["Correct",r.correct_count??"—"],["Incorrect",r.incorrect_count??"—"]].forEach(([label,value])=>{const card=document.createElement("div"),span=document.createElement("span"),strong=document.createElement("strong");span.textContent=label;strong.textContent=value;card.append(span,strong);strip.appendChild(card);});out.appendChild(strip);if(!r.answers?.length){const p=document.createElement("p");p.className="teacher-table-empty";p.textContent="Answer details are unavailable for this attempt.";out.appendChild(p);}else r.answers.forEach((a,i)=>{const card=document.createElement("article");card.className="teacher-result-question";const q=document.createElement("h4");q.textContent=(i+1)+". "+(a.question_text||"Question");card.appendChild(q);const selected=document.createElement("p");selected.textContent="Student answer: "+(a.selected_answer??"Not answered");card.appendChild(selected);const correct=document.createElement("p");correct.className="teacher-result-correct";correct.textContent="Correct answer: "+(a.correct_answer??"Unavailable");card.appendChild(correct);const status=document.createElement("span");status.className="teacher-status-pill "+(a.is_correct?"ready":"failed");status.textContent=a.is_correct?"Correct":a.selected_answer==null?"Unanswered":"Incorrect";card.appendChild(status);const marks=document.createElement("p");marks.className="teacher-form-message";marks.textContent="Marks awarded: "+teacherScore(a.marks_awarded)+" / "+teacherScore(a.marks);card.appendChild(marks);out.appendChild(card);});$("teacher-result-modal").hidden=false;}
$("teacher-results-exam").addEventListener("change",e=>loadTeacherResultRows(e.target.value));$("teacher-results-search").addEventListener("input",renderTeacherResults);$("teacher-results-attempts").addEventListener("change",renderTeacherResults);$("teacher-results-refresh").addEventListener("click",loadTeacherResultsExams);$("teacher-result-close").addEventListener("click",()=>$("teacher-result-modal").hidden=true);$("teacher-result-modal").addEventListener("click",e=>{if(e.target===$("teacher-result-modal"))$("teacher-result-modal").hidden=true;});

async function init() {
  if (!window.supabaseClient) {
    say("The secure connection could not be initialized. Reload this page.");
    return;
  }
  const { data, error } = await window.supabaseClient.auth.getSession();
  if (error || !data?.session) {
    location.replace("admin-login.html");
    return;
  }

  const { data: profile, error: profileError } = await window.supabaseClient
    .from("user_profiles")
    .select("id,full_name,staff_code,role,active")
    .eq("id", data.session.user.id)
    .single();

  if (profileError || !profile) {
    say("Your staff profile could not be loaded. Contact the school CBT administrator.");
    return;
  }
  if (profile.active !== true) {
    await window.supabaseClient.auth.signOut();
    sessionStorage.removeItem("lbis_staff_profile");
    location.replace("admin-login.html");
    return;
  }
  if (profile.role !== "teacher") {
    location.replace(profile.role === "admin" || profile.role === "super_admin" ? "admin-dashboard.html" : "admin-login.html");
    return;
  }

  currentTeacher = profile;
  const name = profile.full_name || "Teacher";
  $("teacher-name").textContent = name;
  $("teacher-top-name").textContent = name;
  $("teacher-code").textContent = profile.staff_code || "—";
  $("teacher-avatar").textContent = name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "T";
  $("teacher-exam-count").textContent = "…";
  await loadExaminations();
  handleGoogleCallbackNotice();
  await loadGoogleConnectionStatus();
}

$("teacher-sign-out").addEventListener("click", async () => {
  const button = $("teacher-sign-out");
  button.disabled = true;
  button.textContent = "Signing out…";
  const { error } = await window.supabaseClient.auth.signOut();
  if (error) {
    button.disabled = false;
    button.textContent = "↪  Sign Out";
    say("Unable to sign out. Please try again.");
    return;
  }
  sessionStorage.removeItem("lbis_staff_profile");
  location.replace("admin-login.html");
});

init().catch(error => {
  console.error("Teacher dashboard:", error);
  say("The teacher dashboard could not be loaded. Refresh the page.");
});
})();