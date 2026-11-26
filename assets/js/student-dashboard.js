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
  let openedResultId=null;
  function escapeReport(value){
    return String(value??"—").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function buildStudentResultReport(result){
    const questions=Array.isArray(result.questions)?result.questions:[];
    const optionText=(options)=>Array.isArray(options)?options.map((o,i)=>String.fromCharCode(65+i)+". "+(typeof o==="string"?o:(o&&(o.text||o.label||o.value))||String(o??""))).join("\n"):"";
    const rows=questions.map((q,i)=>'<tr><td>'+(i+1)+'</td><td>'+escapeReport(q.question_text)+'</td><td>'+escapeReport(optionText(q.options)||"—")+'</td><td>'+escapeReport(q.selected_answer??"Not answered")+'</td><td>'+escapeReport(q.correct_answer??"Not available")+'</td><td>'+escapeReport(q.response_status==="correct"?"Correct":q.response_status==="incorrect"?"Incorrect":"Not answered")+'</td><td>'+escapeReport(q.marks_awarded??0)+' / '+escapeReport(q.marks??0)+'</td></tr>').join("");
    return '<!doctype html><html><head><meta charset="utf-8"><title>LBIS Result - '+escapeReport(result.subject||result.title)+'</title><style>body{font-family:Arial,sans-serif;color:#20232a;margin:28px;font-size:12px;line-height:1.5}header{background:#781d37;color:#fff;padding:22px;text-align:center}h1{font-size:20px;margin:0 0 5px}.sub{font-size:12px}.summary{display:flex;gap:12px;margin:18px 0}.summary div{flex:1;border:1px solid #ddd;padding:12px;border-radius:7px}.summary b{display:block;font-size:17px;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #d8d8d8;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#302d2e;color:#fff}tr:nth-child(even){background:#f7f7f7}.footer{margin-top:24px;border-top:1px solid #ddd;padding-top:10px;color:#666;font-size:10px}@page{size:A4 landscape;margin:12mm}@media print{body{margin:0}thead{display:table-header-group}tr{break-inside:avoid}}</style></head><body><header><h1>LEAD BRITISH INTERNATIONAL SCHOOL</h1><div class="sub">CONFIDENTIAL STUDENT EXAMINATION RESULT</div></header><h2>'+escapeReport(result.subject||result.title||"Examination")+'</h2><p>'+escapeReport(result.title||"")+' | Attempt '+escapeReport(result.attempt_number)+' | Submitted: '+escapeReport(safeDate(result.submitted_at))+'</p><div class="summary"><div>Score<b>'+escapeReport(result.score)+' / '+escapeReport(result.total_marks)+'</b></div><div>Percentage<b>'+escapeReport(result.percentage==null?"—":Number(result.percentage).toFixed(1)+"%")+'</b></div></div><h3>Question and Answer Review</h3><table><thead><tr><th>#</th><th>Question</th><th>Options</th><th>Student Response</th><th>Correct Answer</th><th>Outcome</th><th>Marks</th></tr></thead><tbody>'+rows+'</tbody></table><div class="footer">Confidential Student Record • Designed by TUPS Technologies</div></body></html>';
  }
  function openStudentResultDocument(result,download){
    const win=window.open("","_blank");
    if(!win){resultsMessage.textContent="Please allow pop-ups to print or save this result.";return;}
    win.document.open();win.document.write(buildStudentResultReport(result));win.document.close();win.focus();
    if(download){
      const hint=win.document.createElement("p");
      hint.textContent="To download this report as a PDF, choose “Save as PDF” or “Microsoft Print to PDF” in the print destination.";
      hint.style.cssText="font:12px Arial;color:#555;margin:16px 0;";
      win.document.body.insertBefore(hint,win.document.body.querySelector("h2"));
    }
    setTimeout(()=>{try{win.print();}catch(_){}},500);
  }
  function renderStudentResults(){
    resultsList.replaceChildren();
    openedResultId=null;
    if(!releasedResults.length){
      resultsMessage.textContent="No results have been released by the school yet. Please check again later.";
      resultsMessage.hidden=false;return;
    }
    resultsMessage.textContent="Select a subject and choose View Result. Only one result is displayed at a time.";
    resultsMessage.hidden=false;
    releasedResults.forEach((result,index)=>{
      const row=document.createElement("article");row.className="student-result-subject-row";
      const subject=document.createElement("div");subject.className="student-result-subject-name";
      const heading=document.createElement("strong");heading.textContent=result.subject||result.title||"Examination";
      const sub=document.createElement("small");sub.textContent=(result.title||"")+" • Attempt "+(result.attempt_number||1);
      subject.append(heading,sub);
      const button=document.createElement("button");button.type="button";button.className="student-result-view-button";button.textContent="View Result";
      const panel=document.createElement("div");panel.className="student-result-detail";panel.hidden=true;
      button.addEventListener("click",()=>{
        const isOpen=!panel.hidden;
        resultsList.querySelectorAll(".student-result-detail").forEach(el=>el.hidden=true);
        resultsList.querySelectorAll(".student-result-view-button").forEach(el=>el.textContent="View Result");
        if(isOpen){openedResultId=null;return;}
        panel.hidden=false;button.textContent="Close Result";openedResultId=result.exam_id||String(index);
      });
      const stats=document.createElement("div");stats.className="student-result-stats";
      [["Score",String(result.score)+" / "+String(result.total_marks)],["Percentage",result.percentage==null?"—":Number(result.percentage).toFixed(1)+"%"],["Attempt","Attempt "+result.attempt_number]].forEach(([label,value])=>{
        const item=document.createElement("div"),small=document.createElement("span"),strong=document.createElement("strong");
        small.textContent=label;strong.textContent=value;item.append(small,strong);stats.append(item);
      });
      const submitted=document.createElement("p");submitted.className="student-result-date";submitted.textContent="Submitted: "+safeDate(result.submitted_at);
      const actions=document.createElement("div");actions.className="student-result-report-actions";
      const print=document.createElement("button");print.type="button";print.className="secondary-button";print.textContent="Print Result";print.addEventListener("click",()=>openStudentResultDocument(result,false));
      const download=document.createElement("button");download.type="button";download.className="primary-button";download.textContent="Save as PDF";download.addEventListener("click",()=>openStudentResultDocument(result,true));
      actions.append(print,download);
      const reviewHeading=document.createElement("h4");reviewHeading.className="student-answer-review-heading";reviewHeading.textContent="Question and Answer Review";
      const review=document.createElement("div");review.className="student-answer-review";
      (Array.isArray(result.questions)?result.questions:[]).forEach(question=>{
        const item=document.createElement("section");item.className="student-answer-item";
        const qTitle=document.createElement("h4");qTitle.textContent="Question "+question.question_number;
        const prompt=document.createElement("p");prompt.className="student-answer-question";prompt.textContent=question.question_text||"Question text unavailable";
        const options=document.createElement("div");options.className="student-answer-options";
        const optionsHeading=document.createElement("strong");optionsHeading.textContent="Options:";
        options.appendChild(optionsHeading);
        const optionList=document.createElement("ol");optionList.type="A";
        (Array.isArray(question.options)?question.options:[]).forEach(option=>{
          // The ordered list supplies A/B/C/D; remove letters already included in option text.
          let text=typeof option==="string"?option:(option&&(option.text||option.label||option.value))||String(option??"");
          text=String(text).replace(/^\s*[A-D]\s*[.)-]\s*/i,"")
          const li=document.createElement("li");li.textContent=text;optionList.appendChild(li);
        });
        if(optionList.childElementCount)options.appendChild(optionList);else options.appendChild(document.createTextNode(" No options available."));
        const isCorrect=question.response_status==="correct";
        const response=document.createElement("p");response.className="student-answer-response "+(isCorrect?"correct":"incorrect");response.textContent="Your answer: "+(question.selected_answer??"Not answered");
        const correct=document.createElement("p");correct.className="student-answer-correct";correct.textContent="Correct answer: "+(question.correct_answer??"Not available");
        const state=question.response_status||"not_answered";const outcome=document.createElement("span");outcome.className="student-answer-outcome "+state;outcome.textContent=state==="correct"?"Correct":state==="incorrect"?"Incorrect":"Not answered";
        const marks=document.createElement("p");marks.className="student-answer-marks";marks.textContent="Marks: "+Number(question.marks_awarded||0)+" / "+Number(question.marks||0);
        item.append(qTitle,prompt,options,response,correct,outcome,marks);review.appendChild(item);
      });
      if(!review.childElementCount){const empty=document.createElement("p");empty.textContent="Question-by-question review is not available for this examination.";review.appendChild(empty);}
      panel.append(stats,submitted,actions,reviewHeading,review);
      row.append(subject,button);resultsList.append(row,panel);
    });
  }
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

  // A dashboard restored from browser history must still have a valid student token.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      if (!getSession()) signOut();
      else loadDashboard();
    }
  });
  window.addEventListener("popstate", () => {
    if (!getSession()) signOut();
  });
  loadDashboard();
})();