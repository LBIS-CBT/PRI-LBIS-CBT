(() => {
"use strict";
const $=id=>document.getElementById(id);
const layout=$("admin-layout"), notice=$("dashboard-message");
if(!layout)return;
if(window.matchMedia("(max-width:600px)").matches){$("unsupported-device").hidden=false;return;}
const setNotice=(s)=>{notice.textContent=s||""};
const label=r=>r==="super_admin"?"Super Administrator":r==="admin"?"Administrator":"Staff";
function showPanel(name){
 document.querySelectorAll(".panel-view").forEach(p=>p.classList.toggle("active",p.id==="panel-"+name));
 document.querySelectorAll(".nav-button").forEach(b=>b.classList.toggle("active",b.dataset.panel===name));
 const active=document.querySelector('[data-panel="'+name+'"]');
 $("page-title").textContent=active?active.textContent.trim():"Dashboard";
 setNotice("");
 if(name==="add-class")loadClasses();
 if(name==="add-student")loadStudentClasses();
 if(name==="manage-students")loadManageStudents();
 if(name==="teachers")loadTeachers();
 if(name==="live-candidates")loadLiveCandidates();
 if(name==="examinations")loadExamManagement();
}
document.querySelectorAll("[data-panel]").forEach(b=>b.addEventListener("click",()=>showPanel(b.dataset.panel)));
async function session(){
 if(!window.supabaseClient){setNotice("Secure connection unavailable. Reload this page.");return null;}
 const timeout=(promise,ms,message)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(message)),ms))]);
 const paintProfile=p=>{
  $("staff-name").textContent=p.full_name||"Administrator";$("staff-code").textContent=p.staff_code||"—";
  $("staff-role").textContent=label(p.role);$("profile-role").textContent=label(p.role);
  $("top-user").textContent=p.full_name||p.staff_code||"Administrator";
  $("user-initials").textContent=(p.full_name||"LB").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
 };
 const cached=(()=>{try{return JSON.parse(sessionStorage.getItem("lbis_staff_profile")||"null");}catch(_){return null;}})();
 try{
  const {data,error}=await timeout(window.supabaseClient.auth.getSession(),10000,"Authentication session check timed out.");
  if(error)throw error;
  if(!data?.session){location.replace("admin-login.html");return null;}
  let p=null;
  try{
   const result=await timeout(window.supabaseClient.from("user_profiles").select("id,full_name,staff_code,role,active").eq("id",data.session.user.id).single(),10000,"Account profile check timed out.");
   if(result.error)throw result.error;
   p=result.data;
  }catch(profileError){
   if(cached?.id===data.session.user.id&&["admin","super_admin"].includes(cached.role)){
    console.warn("LBIS profile refresh unavailable; using the signed-in profile for display. Protected actions remain server-authorized.",profileError);
    p={...cached,active:true};
    setNotice("Account details could not be refreshed right now. Protected actions will still be checked securely.");
   }else throw profileError;
  }
  if(!p||p.active===false){await window.supabaseClient.auth.signOut();sessionStorage.removeItem("lbis_staff_profile");location.replace("admin-login.html");return null;}
  if(!["admin","super_admin"].includes(p.role)){location.replace("staff-dashboard.html");return null;}
  paintProfile(p);
  return {profile:p,session:data.session};
 }catch(error){
  console.error("LBIS dashboard account initialization failed:",error);
  setNotice((error?.message||"Account verification failed.")+" Please sign in again. If this continues, open the browser console and share the first red error.");
  $("top-user").textContent="Account verification failed";
  $("staff-role").textContent="Access not verified";
  return null;
 }
}
let context=null;
const examBody=$("exam-table-body");
function renderExamRows(rows){
 examBody.replaceChildren();
 if(!Array.isArray(rows)||rows.length===0){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.className="table-empty";td.textContent="No examinations are currently available.";tr.appendChild(td);examBody.appendChild(tr);return;}
 rows.forEach(exam=>{
  const tr=document.createElement("tr"),subject=document.createElement("td"),klass=document.createElement("td"),controls=document.createElement("td"),status=document.createElement("td"),count=document.createElement("td");
  subject.textContent=exam.subject||exam.title||"—";klass.textContent=exam.class_name||exam.class_label||"—";
  const accepting=exam.accepts_new_candidates===true,canStart=["ready","active","completed"].includes(String(exam.status||"").toLowerCase());
  const wrap=document.createElement("div");wrap.className="exam-controls";const action=document.createElement("button");action.type="button";action.className="exam-action "+(accepting?"close":"start");action.textContent=accepting?"Close to New Candidates":"Start Exam";action.disabled=!canStart;action.addEventListener("click",()=>setExamEntry(exam.id,!accepting,action));wrap.appendChild(action);controls.appendChild(wrap);
  const pill=document.createElement("span");pill.className="exam-status "+String(exam.status||"draft").toLowerCase();pill.textContent=String(exam.status||"draft").replaceAll("_"," ");status.appendChild(pill);
  count.textContent=Number(exam.candidate_count??exam.candidates_count??0).toLocaleString();
  [subject,klass,controls,status,count].forEach(td=>tr.appendChild(td));examBody.appendChild(tr);
 });
}
async function loadExaminations(){
 if(!context)return;const btn=$("refresh-examinations");btn.disabled=true;btn.textContent="Refreshing…";
 const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.className="table-empty";td.textContent="Loading examination records…";tr.appendChild(td);examBody.replaceChildren(tr);
 try{const {data,error}=await window.supabaseClient.functions.invoke("admin-examinations",{body:{action:"list_examinations"}});if(error)throw error;if(!data||data.success===false)throw new Error(data?.message||"Examination records could not be loaded.");renderExamRows(data.examinations||data.data||[]);}
 catch(err){const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=5;cell.className="table-empty";cell.textContent="The examination table is ready, but its secure data service has not yet been deployed. Records and controls will become available after that service is connected.";row.appendChild(cell);examBody.replaceChildren(row);console.warn("LBIS examinations could not be loaded:",err);}
 finally{btn.disabled=false;btn.textContent="Refresh Examinations";}
}
async function setExamEntry(examId,accepting,button){
 button.disabled=true;const original=button.textContent;button.textContent="Saving…";
 try{const {data,error}=await window.supabaseClient.functions.invoke("admin-examinations",{body:{action:"set_candidate_entry",exam_id:examId,accepts_new_candidates:accepting}});if(error)throw error;if(!data||data.success===false)throw new Error(data?.message||"Exam setting was not updated.");setNotice(data.message||"Examination entry setting updated.");await loadExaminations();if($("panel-examinations")?.classList.contains("active"))await loadExamManagement();}
 catch(err){setNotice(err.message||"Unable to update examination entry.");button.disabled=false;button.textContent=original;}
}


let managementExams=[],managementCandidates=[],selectedManagementExam=null;
function safeCell(value){const td=document.createElement("td");td.textContent=value??"—";return td;}
function renderManagementExams(){
 const body=$("management-exam-body");body.replaceChildren();
 if(!managementExams.length){const tr=document.createElement("tr"),td=safeCell("No examinations found.");td.colSpan=7;td.className="table-empty";tr.appendChild(td);body.appendChild(tr);return;}
 managementExams.forEach(exam=>{
  const tr=document.createElement("tr"),title=safeCell(exam.subject||exam.title||"—"),klass=safeCell(exam.class_label||exam.class_name||"—"),status=safeCell(String(exam.status||"—").replaceAll("_"," ")),entry=safeCell(exam.accepts_new_candidates?"Open":"Closed"),count=safeCell(String(exam.candidate_count??0)),attempted=safeCell(String(exam.attempted_count??0)),action=safeCell("");
  const btn=document.createElement("button");btn.type="button";btn.className="exam-action "+(exam.accepts_new_candidates?"close":"start");btn.textContent=exam.accepts_new_candidates?"Close Entry":"Open / Reopen";btn.disabled=!["ready","active","completed"].includes(String(exam.status||"").toLowerCase());btn.addEventListener("click",()=>setExamEntry(exam.id,!exam.accepts_new_candidates,btn));action.appendChild(btn);
  [title,klass,status,entry,count,attempted,action].forEach(x=>tr.appendChild(x));body.appendChild(tr);
 });
 const select=$("exam-candidate-select"),previous=select.value;select.replaceChildren(new Option("Choose an examination",""));
 managementExams.forEach(e=>select.add(new Option((e.subject||e.title||"Examination")+" — "+(e.class_label||e.class_name||"Class"),e.id)));
 if(managementExams.some(e=>e.id===previous))select.value=previous;
}
async function loadExamManagement(){
 if(!context)return;
 const body=$("management-exam-body"),btn=$("refresh-exam-management");
 if(btn){btn.disabled=true;btn.textContent="Loading…";}
 body.innerHTML='<tr><td colspan="7" class="table-empty">Loading examination records…</td></tr>';
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("admin-examinations",{body:{action:"list_examinations"}});
  if(error)throw error;if(!data||data.success!==true)throw new Error(data?.message||"Examination records could not be loaded.");
  managementExams=data.examinations||[];renderManagementExams();
  if($("exam-candidate-select").value)await loadExamCandidates($("exam-candidate-select").value);
 }catch(err){body.innerHTML='<tr><td colspan="7" class="table-empty"></td></tr>';body.querySelector("td").textContent=err.message||"Unable to load examinations.";setNotice(err.message||"Examination management could not be loaded.");}
 finally{if(btn){btn.disabled=false;btn.textContent="Refresh Examinations";}}
}
async function loadExamCandidates(examId){
 const body=$("exam-candidates-body");selectedManagementExam=examId;managementCandidates=[];
 if(!examId){body.innerHTML='<tr><td colspan="7" class="table-empty">Choose an examination above.</td></tr>';return;}
 body.innerHTML='<tr><td colspan="7" class="table-empty">Loading candidate attempts…</td></tr>';
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("admin-examinations",{body:{action:"list_exam_candidates",exam_id:examId}});
  if(error)throw error;if(!data||data.success!==true)throw new Error(data?.message||"Candidate histories could not be loaded.");
  managementCandidates=data.candidates||[];renderExamCandidates();
 }catch(err){body.innerHTML='<tr><td colspan="7" class="table-empty"></td></tr>';body.querySelector("td").textContent=err.message||"Unable to load candidate histories.";}
}
function renderExamCandidates(){
 const body=$("exam-candidates-body");body.replaceChildren();
 if(!managementCandidates.length){body.innerHTML='<tr><td colspan="7" class="table-empty">No candidates are registered in this examination class.</td></tr>';return;}
 managementCandidates.forEach(record=>{
  const s=record.student||{},attempts=record.attempts||[],auths=record.authorizations||[],pending=auths.find(a=>a.status==="pending"),latest=[...attempts].sort((a,b)=>Number(b.attempt_number)-Number(a.attempt_number))[0];
  const tr=document.createElement("tr"),name=s.full_name||"—",admission=s.admission_number||"—",active=s.active===false?"Inactive":"Active";
  const attemptsText=attempts.length?attempts.length+" attempt(s)":"No attempt";
  const result=latest?(String(latest.status||"").replaceAll("_"," ")+" • "+(latest.score===null||latest.score===undefined?"Score pending":Number(latest.score).toFixed(2))):"Not attempted";
  const approval=pending?"Approved — pending use":auths.length?String(auths[0].status||"").replaceAll("_"," "):"None";
  const action=safeCell("");
  const view=document.createElement("button");view.type="button";view.className="secondary-button";view.textContent="History";view.addEventListener("click",()=>showCandidateHistory(record));
  action.appendChild(view);
  if(pending){const revoke=document.createElement("button");revoke.type="button";revoke.className="secondary-button";revoke.textContent="Revoke";revoke.addEventListener("click",()=>revokeCandidateRetake(pending));action.appendChild(revoke);}
  else if(attempts.length&&s.active!==false){const authorize=document.createElement("button");authorize.type="button";authorize.className="exam-action start";authorize.textContent="Authorise Retake";authorize.addEventListener("click",()=>authorizeCandidateRetake(s));action.appendChild(authorize);}
  [safeCell(name),safeCell(admission),safeCell(active),safeCell(attemptsText),safeCell(result),safeCell(approval),action].forEach(x=>tr.appendChild(x));body.appendChild(tr);
 });
}
function showCandidateHistory(record){
 const s=record.student||{},attempts=record.attempts||[],auths=record.authorizations||[];
 $("exam-history-title").textContent=s.full_name||"Candidate Attempt History";
 $("exam-history-subtitle").textContent=(s.admission_number||"")+" • "+attempts.length+" recorded attempt(s)";
 const area=$("exam-history-content");area.replaceChildren();
 const table=document.createElement("table");table.className="staff-table";
 const head=document.createElement("tr");["Attempt","Status","Started","Submitted","Answered","Score"].forEach(x=>{const th=document.createElement("th");th.textContent=x;head.appendChild(th);});table.appendChild(head);
 attempts.forEach(a=>{const tr=document.createElement("tr");[String(a.attempt_number??"—"),String(a.status||"—").replaceAll("_"," "),a.started_at?new Date(a.started_at).toLocaleString():"—",a.submitted_at?new Date(a.submitted_at).toLocaleString():"—",String(a.answered_count??0),a.score===null||a.score===undefined?"—":Number(a.score).toFixed(2)].forEach(v=>tr.appendChild(safeCell(v)));table.appendChild(tr);});
 area.appendChild(table);
 const heading=document.createElement("h4");heading.textContent="Retake authorisation history";area.appendChild(heading);
 if(!auths.length){const p=document.createElement("p");p.className="form-help";p.textContent="No retake approvals have been recorded.";area.appendChild(p);}
 auths.forEach(a=>{const p=document.createElement("p");p.className="exam-auth-history";p.textContent=(a.status||"").toUpperCase()+" • "+(a.reason||"No reason supplied")+" • "+(a.authorized_at?new Date(a.authorized_at).toLocaleString():"");area.appendChild(p);});
 $("exam-candidate-history").hidden=false;
}
async function authorizeCandidateRetake(student){
 if(!selectedManagementExam)return;
 const reason=window.prompt("Enter the reason for authorising this candidate to retake the examination:");
 if(reason===null)return;if(!reason.trim()){setNotice("A reason is required before a retake can be authorised.");return;}
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("admin-examinations",{body:{action:"authorize_retake",exam_id:selectedManagementExam,student_id:student.id,reason:reason.trim()}});
  if(error)throw error;if(!data||data.success!==true)throw new Error(data?.message||"Retake authorisation failed.");
  setNotice(data.message||"Retake authorised.");await loadExamCandidates(selectedManagementExam);
 }catch(err){setNotice(err.message||"Unable to authorise this retake.");}
}
async function revokeCandidateRetake(authorization){
 if(!window.confirm("Revoke this pending retake approval? The candidate will remain locked out."))return;
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("admin-examinations",{body:{action:"revoke_retake",authorization_id:authorization.id}});
  if(error)throw error;if(!data||data.success!==true)throw new Error(data?.message||"Retake approval could not be revoked.");
  setNotice(data.message||"Retake approval revoked.");await loadExamCandidates(selectedManagementExam);
 }catch(err){setNotice(err.message||"Unable to revoke this approval.");}
}
$("refresh-exam-management").addEventListener("click",loadExamManagement);
$("exam-candidate-select").addEventListener("change",ev=>loadExamCandidates(ev.target.value));
$("exam-history-close").addEventListener("click",()=>$("exam-candidate-history").hidden=true);

$("add-teacher-form").addEventListener("submit",async ev=>{
 ev.preventDefault();if(!context)return;
 const form=ev.currentTarget,btn=$("create-teacher-button"),v=Object.fromEntries(new FormData(form).entries());
 btn.disabled=true;btn.textContent="Creating account…";setNotice("");
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("staff-management",{body:{action:"create_staff",full_name:v.full_name,staff_code:v.staff_code,email:v.email,password:v.password,role:"teacher"}});
  if(error)throw error;
  if(!data||data.success===false)throw new Error(data?.message||data?.error||"Teacher account creation failed.");
  form.reset();setNotice(data.message||"Teacher account created successfully.");
 }catch(err){setNotice(err.message||"Unable to create teacher account. Please try again.");}
 finally{btn.disabled=false;btn.textContent="Create Teacher Account";}
});
$("global-exam-password-form").addEventListener("submit", async (event) => {
 event.preventDefault();
 if (!context) { setNotice("Administrator access has not been verified."); return; }
 const form = event.currentTarget;
 const password = form.elements.new_password.value;
 const confirmation = form.elements.confirm_password.value;
 const button = $("reset-global-exam-password");
 if (password.length < 8) { setNotice("The new password must contain at least 8 characters."); return; }
 if (password !== confirmation) { setNotice("The two password entries do not match."); return; }
 if (!window.confirm("Reset the one global examination password for every subject and examination?")) return;
 button.disabled = true; button.textContent = "Resetting…"; setNotice("");
 try {
  const { data, error } = await window.supabaseClient.functions.invoke("admin-exam-access", {
   body: { action: "reset_global_password", new_password: password }
  });
  if (error) throw error;
  if (!data || data.success !== true) throw new Error(data?.message || "The global examination password could not be reset.");
  form.reset(); setNotice(data.message || "Global examination password reset successfully.");
 } catch (error) {
  setNotice(error?.message || "Unable to reset the global examination password.");
 } finally {
  button.disabled = false; button.textContent = "Reset Global Password";
 }
});
async function loadClasses(){
 if(!context)return;
 const area=$("classes-content");
 if(area)area.textContent="Loading classes…";
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("admin-classes",{body:{action:"list_classes"}});
  if(error)throw error;
  if(!data||data.success===false)throw new Error(data?.message||"Could not load classes.");
  const classes=data.classes||[];
  if(!classes.length){area.textContent="No classes have been created yet. Use the form above to add the first class.";return;}
  const table=document.createElement("table");table.className="staff-table";
  const head=document.createElement("tr");
  ["Class Name","Level / Section","Display Order","Status"].forEach(t=>{const th=document.createElement("th");th.textContent=t;head.appendChild(th);});
  table.appendChild(head);
  classes.forEach(c=>{
   const tr=document.createElement("tr");
   [c.name||"—",c.level||"—",String(c.sort_order??0),c.active===false?"Inactive":"Active"].forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.appendChild(td);});
   table.appendChild(tr);
  });
  area.replaceChildren(table);
 }catch(err){area.textContent=err.message||"Class list could not be loaded.";}
}
$("add-class-form").addEventListener("submit",async ev=>{
 ev.preventDefault();if(!context)return;
 const form=ev.currentTarget,btn=$("create-class-button"),v=Object.fromEntries(new FormData(form).entries());
 btn.disabled=true;btn.textContent="Creating class…";setNotice("");
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("admin-classes",{body:{
   action:"create_class",name:v.name,level:v.level,sort_order:v.sort_order
  }});
  if(error)throw error;
  if(!data||data.success===false)throw new Error(data?.message||"Class creation failed.");
  form.reset();form.elements.sort_order.value="0";
  setNotice(data.message||"Class created successfully.");
  await loadClasses();
 }catch(err){setNotice(err.message||"Unable to create class. Please try again.");}
 finally{btn.disabled=false;btn.textContent="Create Class";}
}
);
$("refresh-classes").addEventListener("click",loadClasses);
async function loadStudentClasses(){
 const select=$("student-class");
 if(!context||!select)return;
 select.disabled=true;select.replaceChildren(new Option("Loading classes…",""));
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("admin-classes",{body:{action:"list_classes"}});
  if(error)throw error;
  if(!data||data.success===false)throw new Error(data?.message||"Could not load classes.");
  select.replaceChildren(new Option("Select a class",""));
  (data.classes||[]).forEach(c=>{
   const label=c.level?c.name+" — "+c.level:c.name;
   select.add(new Option(label,c.id));
  });
  if(!(data.classes||[]).length)select.replaceChildren(new Option("No active classes available",""));
 }catch(err){
  select.replaceChildren(new Option("Unable to load classes — retry by reopening this section",""));
  setNotice(err.message||"Class list could not be loaded.");
 }finally{select.disabled=false;}
}
$("add-student-form").addEventListener("submit",async ev=>{
 ev.preventDefault();if(!context)return;
 const form=ev.currentTarget,btn=$("create-student-button"),v=Object.fromEntries(new FormData(form).entries());
 btn.disabled=true;btn.textContent="Saving student…";setNotice("");
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("admin-students",{body:{
   action:"create_student",
   full_name:v.full_name,
   admission_number:v.admission_number,
   class_id:v.class_id||null
  }});
  if(error)throw error;
  if(!data||data.success===false)throw new Error(data?.message||"Student registration failed.");
  form.reset();
  setNotice(data.message||"Student added successfully.");
 }catch(err){setNotice(err.message||"Unable to add student. Please try again.");}
 finally{btn.disabled=false;btn.textContent="Add Student";}
});
let studentRecords=[],studentPage=1,studentPageSize=25,studentClasses=[];
function classLabel(id){const c=studentClasses.find(x=>x.id===id);return c?c.name+(c.level?" — "+c.level:""):"—";}
function renderManageStudents(){
 const tbody=$("manage-students-body");tbody.replaceChildren();
 const q=$("student-search").value.trim().toLowerCase(),classId=$("manage-student-class").value;
 const rows=studentRecords.filter(s=>(!q||String(s.full_name||"").toLowerCase().includes(q)||String(s.admission_number||"").toLowerCase().includes(q))&&(!classId||s.class_id===classId));
 const pages=Math.max(1,Math.ceil(rows.length/studentPageSize));studentPage=Math.min(studentPage,pages);
 const visible=rows.slice((studentPage-1)*studentPageSize,studentPage*studentPageSize);
 if(!visible.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.className="table-empty";td.textContent="No matching students found.";tr.appendChild(td);tbody.appendChild(tr);}
 visible.forEach(s=>{
  const tr=document.createElement("tr");
  [s.admission_number||"—",s.full_name||"—",classLabel(s.class_id),s.active===false?"Inactive":"Active"].forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.appendChild(td);});
  const td=document.createElement("td"),view=document.createElement("button"),edit=document.createElement("button"),toggle=document.createElement("button");
  view.className=edit.className=toggle.className="secondary-button";view.type=edit.type=toggle.type="button";
  view.textContent="View";edit.textContent="Edit";toggle.textContent=s.active===false?"Activate":"Deactivate";
  view.addEventListener("click",()=>openStudentModal(s,false));edit.addEventListener("click",()=>openStudentModal(s,true));toggle.addEventListener("click",()=>toggleStudentActive(s,toggle));
  td.append(view,edit,toggle);tr.appendChild(td);tbody.appendChild(tr);
 });
 $("student-page-info").textContent="Page "+studentPage+" of "+pages+" • "+rows.length+" student(s)";
 $("student-prev").disabled=studentPage<=1;$("student-next").disabled=studentPage>=pages;
}
async function loadManageStudents(){
 if(!context)return;const body=$("manage-students-body");body.innerHTML='<tr><td colspan="5" class="table-empty">Loading student records…</td></tr>';
 try{
  const [studentRes,classRes]=await Promise.all([
   window.supabaseClient.functions.invoke("admin-students",{body:{action:"list_students"}}),
   window.supabaseClient.functions.invoke("admin-classes",{body:{action:"list_classes"}})
  ]);
  if(studentRes.error)throw studentRes.error;if(studentRes.data?.success===false)throw new Error(studentRes.data.message||"Unable to retrieve students.");
  if(classRes.error)throw classRes.error;if(classRes.data?.success===false)throw new Error(classRes.data.message||"Unable to retrieve classes.");
  studentRecords=studentRes.data.students||[];studentClasses=classRes.data.classes||[];
  const filter=$("manage-student-class"),editSelect=$("edit-student-class");
  const selected=filter.value;filter.replaceChildren(new Option("All classes",""));
  studentClasses.forEach(c=>filter.add(new Option(c.name+(c.level?" — "+c.level:""),c.id)));
  if(studentClasses.some(c=>c.id===selected))filter.value=selected;
  editSelect.replaceChildren();studentClasses.forEach(c=>editSelect.add(new Option(c.name+(c.level?" — "+c.level:""),c.id)));
  studentPage=1;renderManageStudents();
 }catch(err){body.replaceChildren();const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.className="table-empty";td.textContent=err.message||"Student records could not be loaded.";tr.appendChild(td);body.appendChild(tr);}
}
function openStudentModal(s,editing){
 const modal=$("student-edit-modal"),form=$("manage-student-edit-form");form.elements.id.value=s.id;form.elements.full_name.value=s.full_name||"";form.elements.admission_number.value=s.admission_number||"";form.elements.class_id.value=s.class_id||"";
 $("student-modal-title").textContent=editing?"Edit Student":"Student Details";form.querySelectorAll("input:not([type=hidden]),select").forEach(el=>el.disabled=!editing);
 $("save-student-edit").hidden=!editing;
 const details=$("student-view-details");details.textContent=editing?"":"Status: "+(s.active===false?"Inactive":"Active");
 modal.hidden=false;form.dataset.editing=editing?"true":"false";
}
async function toggleStudentActive(s,button){
 const next=s.active===false,old=button.textContent;button.disabled=true;button.textContent="Updating…";
 try{const {data,error}=await window.supabaseClient.functions.invoke("admin-students",{body:{action:"set_student_active",student_id:s.id,active:next}});if(error)throw error;if(!data||data.success===false)throw new Error(data?.message||"Student status could not be changed.");setNotice(data.message||"Student status updated.");await loadManageStudents();}
 catch(err){setNotice(err.message||"Unable to update student status.");button.disabled=false;button.textContent=old;}
}
$("refresh-students").addEventListener("click",loadManageStudents);
$("student-search").addEventListener("input",()=>{studentPage=1;renderManageStudents();});
$("manage-student-class").addEventListener("change",()=>{studentPage=1;renderManageStudents();});
$("student-prev").addEventListener("click",()=>{if(studentPage>1){studentPage--;renderManageStudents();}});
$("student-next").addEventListener("click",()=>{studentPage++;renderManageStudents();});
$("student-modal-close").addEventListener("click",()=>{$("student-edit-modal").hidden=true;});
$("manage-student-edit-form").addEventListener("submit",async ev=>{
 ev.preventDefault();const form=ev.currentTarget;if(form.dataset.editing!=="true")return;
 const v=Object.fromEntries(new FormData(form).entries()),btn=$("save-student-edit");btn.disabled=true;btn.textContent="Saving…";
 try{const {data,error}=await window.supabaseClient.functions.invoke("admin-students",{body:{action:"update_student",student_id:v.id,full_name:v.full_name,admission_number:v.admission_number,class_id:v.class_id}});if(error)throw error;if(!data||data.success===false)throw new Error(data?.message||"Student update failed.");$("student-edit-modal").hidden=true;setNotice(data.message||"Student updated.");await loadManageStudents();}
 catch(err){setNotice(err.message||"Unable to save student changes.");}
 finally{btn.disabled=false;btn.textContent="Save Changes";}
});
let teacherRecords=[],teacherPage=1,teacherPageSize=25,selectedTeacher=null;
function renderTeachers(){
 const body=$("teachers-table-body");body.replaceChildren();
 const q=$("teacher-search").value.trim().toLowerCase(),status=$("teacher-status-filter").value;
 const rows=teacherRecords.filter(s=>{
  const active=s.active!==false;
  return (s.role==="teacher")&&(!q||String(s.full_name||"").toLowerCase().includes(q)||String(s.staff_code||"").toLowerCase().includes(q))&&(!status||(status==="active"?active:!active));
 });
 const pages=Math.max(1,Math.ceil(rows.length/teacherPageSize));teacherPage=Math.min(teacherPage,pages);
 const visible=rows.slice((teacherPage-1)*teacherPageSize,teacherPage*teacherPageSize);
 if(!visible.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.className="table-empty";td.textContent="No matching teacher accounts found.";tr.appendChild(td);body.appendChild(tr);}
 visible.forEach(s=>{
  const tr=document.createElement("tr");
  [s.full_name||"—",s.staff_code||"—",s.email||"—",s.active===false?"Inactive":"Active"].forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.appendChild(td);});
  const td=document.createElement("td"),view=document.createElement("button"),edit=document.createElement("button"),reset=document.createElement("button"),toggle=document.createElement("button");
  [view,edit,reset,toggle].forEach(b=>{b.type="button";b.className="secondary-button";});
  view.textContent="View";edit.textContent="Edit";reset.textContent="Reset Password";toggle.textContent=s.active===false?"Reactivate":"Deactivate";
  view.addEventListener("click",()=>openTeacherModal(s,false));edit.addEventListener("click",()=>openTeacherModal(s,true));
  reset.addEventListener("click",()=>openTeacherModal(s,true,true));toggle.addEventListener("click",()=>toggleTeacherActive(s,toggle));
  td.append(view,edit,reset,toggle);tr.appendChild(td);body.appendChild(tr);
 });
 $("teacher-page-info").textContent="Page "+teacherPage+" of "+pages+" • "+rows.length+" teacher(s)";
 $("teacher-prev").disabled=teacherPage<=1;$("teacher-next").disabled=teacherPage>=pages;
}
async function loadTeachers(){
 if(!context)return;const btn=$("reload-teachers"),body=$("teachers-table-body");btn.disabled=true;btn.textContent="Loading…";
 body.innerHTML='<tr><td colspan="5" class="table-empty">Loading teacher accounts…</td></tr>';
 try{
  const all=[];let page=1,total=0;
  do{
   const {data,error}=await window.supabaseClient.functions.invoke("staff-management",{body:{action:"list_staff",page,limit:100}});
   if(error)throw error;
   if(!data||data.success===false)throw new Error(data?.error||data?.message||"Unable to retrieve staff.");
   all.push(...(data.staff||[]));total=Number(data.total??all.length);page++;
   if(page>10000)throw new Error("The staff list exceeded the supported page limit.");
  }while(all.length<total);
  teacherRecords=all.filter(s=>s.role==="teacher");teacherPage=1;renderTeachers();
 }catch(err){body.replaceChildren();const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.className="table-empty";td.textContent=err.message||"Teacher accounts could not be loaded.";tr.appendChild(td);body.appendChild(tr);}
 finally{btn.disabled=false;btn.textContent="Refresh Teachers";}
}
function openTeacherModal(s,editing,resetOnly=false){
 selectedTeacher=s;const form=$("teacher-edit-form");
 form.elements.id.value=s.id;form.elements.full_name.value=s.full_name||"";form.elements.staff_code.value=s.staff_code||"";form.elements.email.value=s.email||"";
 $("teacher-modal-title").textContent=resetOnly?"Reset Teacher Password":editing?"Edit Teacher":"Teacher Details";
 form.querySelectorAll("input:not([type=hidden])").forEach(el=>el.disabled=!editing||resetOnly);
 $("save-teacher-edit").hidden=!editing||resetOnly;
 $("teacher-modal-status").textContent="Account status: "+(s.active===false?"Inactive":"Active")+" • Role: "+label(s.role);
 $("teacher-reset-form").hidden=!resetOnly;
 $("teacher-modal").hidden=false;
}
async function toggleTeacherActive(s,button){
 const next=s.active===false,old=button.textContent;button.disabled=true;button.textContent="Updating…";
 try{
  const action=next?"reactivate_staff":"deactivate_staff";
  const {data,error}=await window.supabaseClient.functions.invoke("staff-management",{body:{action,staff_id:s.id}});
  if(error)throw error;if(!data||data.success===false)throw new Error(data?.message||data?.error||"Teacher status could not be changed.");
  setNotice(data.message||(next?"Teacher reactivated.":"Teacher deactivated."));await loadTeachers();
 }catch(err){setNotice(err.message||"Unable to update teacher status.");button.disabled=false;button.textContent=old;}
}
$("reload-teachers").addEventListener("click",loadTeachers);
$("teacher-search").addEventListener("input",()=>{teacherPage=1;renderTeachers();});
$("teacher-status-filter").addEventListener("change",()=>{teacherPage=1;renderTeachers();});
$("teacher-prev").addEventListener("click",()=>{if(teacherPage>1){teacherPage--;renderTeachers();}});
$("teacher-next").addEventListener("click",()=>{teacherPage++;renderTeachers();});
$("teacher-modal-close").addEventListener("click",()=>{$("teacher-modal").hidden=true;});
$("teacher-edit-form").addEventListener("submit",async ev=>{
 ev.preventDefault();const form=ev.currentTarget,v=Object.fromEntries(new FormData(form).entries()),btn=$("save-teacher-edit");
 if(!selectedTeacher)return;btn.disabled=true;btn.textContent="Saving…";
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("staff-management",{body:{action:"update_staff_profile",staff_id:v.id,full_name:v.full_name,staff_code:v.staff_code,email:v.email}});
  if(error)throw error;if(!data||data.success===false)throw new Error(data?.message||data?.error||"Teacher profile update failed.");
  $("teacher-modal").hidden=true;setNotice(data.message||"Teacher profile updated.");await loadTeachers();
 }catch(err){setNotice(err.message||"Unable to update teacher profile.");}
 finally{btn.disabled=false;btn.textContent="Save Changes";}
});
$("teacher-reset-form").addEventListener("submit",async ev=>{
 ev.preventDefault();if(!selectedTeacher)return;const form=ev.currentTarget,btn=$("reset-teacher-password"),password=form.elements.password.value;
 if(password.length<12){setNotice("The new password must contain at least 12 characters.");return;}
 btn.disabled=true;btn.textContent="Resetting…";
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("staff-management",{body:{action:"reset_staff_password",staff_id:selectedTeacher.id,new_password:password}});
  if(error)throw error;if(!data||data.success===false)throw new Error(data?.message||data?.error||"Password reset failed.");
  form.reset();$("teacher-modal").hidden=true;setNotice(data.message||"Teacher password reset successfully.");
 }catch(err){setNotice(err.message||"Unable to reset teacher password.");}
 finally{btn.disabled=false;btn.textContent="Reset Password";}
});
let liveCandidateRecords=[];
function formatClock(value){if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});}
function renderLiveCandidates(){
 const body=$("live-candidates-body");body.replaceChildren();
 const q=$("live-search").value.trim().toLowerCase(),examId=$("live-exam-filter").value;
 const rows=liveCandidateRecords.filter(c=>{
  const s=c.student||{},e=c.examination||{};
  return (!q||String(s.full_name||"").toLowerCase().includes(q)||String(s.admission_number||"").toLowerCase().includes(q))&&(!examId||e.id===examId);
 });
 if(!rows.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=8;td.className="table-empty";td.textContent=liveCandidateRecords.length?"No candidates match these filters.":"There are currently no candidates taking an examination.";tr.appendChild(td);body.appendChild(tr);}
 rows.forEach(c=>{
  const s=c.student||{},e=c.examination||{},tr=document.createElement("tr");
  const remaining=c.deadline_at?Math.max(0,Math.ceil((new Date(c.deadline_at).getTime()-Date.now())/60000)):null;
  const values=[s.full_name||"—",s.admission_number||"—",(e.class_name||"—")+(e.class_level?" — "+e.class_level:""),e.subject||e.title||"—",formatClock(c.started_at),remaining===null?"—":remaining+" min",String(c.answered_count??0),"In Progress"];
  values.forEach((v,i)=>{const td=document.createElement("td");td.textContent=v;if(i===7){const pill=document.createElement("span");pill.className="exam-status active";pill.textContent=v;td.replaceChildren(pill);}tr.appendChild(td);});body.appendChild(tr);
 });
 $("live-page-info").textContent=rows.length+" candidate(s) shown • "+liveCandidateRecords.length+" active";
}
async function loadLiveCandidates(){
 if(!context)return;const btn=$("refresh-live"),body=$("live-candidates-body");btn.disabled=true;btn.textContent="Refreshing…";$("live-status").textContent="Checking";
 body.innerHTML='<tr><td colspan="8" class="table-empty">Retrieving active candidate sessions…</td></tr>';
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("admin-live-candidates",{body:{action:"list_live_candidates"}});
  if(error)throw error;if(!data||data.success===false)throw new Error(data?.message||"Live candidate records could not be loaded.");
  liveCandidateRecords=data.candidates||[];$("live-total").textContent=String(data.total??liveCandidateRecords.length);$("live-status").textContent="Connected";
  $("live-updated").textContent=new Date(data.generated_at||Date.now()).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  const filter=$("live-exam-filter"),selected=filter.value;filter.replaceChildren(new Option("All examinations",""));
  const exams=new Map();liveCandidateRecords.forEach(c=>{if(c.examination?.id)exams.set(c.examination.id,c.examination);});
  [...exams.values()].forEach(e=>filter.add(new Option(e.subject||e.title||"Examination",e.id)));
  if(exams.has(selected))filter.value=selected;
  renderLiveCandidates();setNotice(data.truncated?"Showing the latest 500 active sessions.":"");
 }catch(err){liveCandidateRecords=[];$("live-total").textContent="—";$("live-status").textContent="Unavailable";body.innerHTML='<tr><td colspan="8" class="table-empty"></td></tr>';body.querySelector("td").textContent=err.message||"Unable to load live candidates.";setNotice(err.message||"Live monitoring could not be loaded.");console.error("Live candidates:",err);}
 finally{btn.disabled=false;btn.textContent="Refresh Candidates";}
}
$("refresh-live").addEventListener("click",loadLiveCandidates);
$("live-search").addEventListener("input",renderLiveCandidates);
$("live-exam-filter").addEventListener("change",renderLiveCandidates);
setInterval(renderLiveCandidates,60000);
$("sign-out-button").addEventListener("click",async()=>{const b=$("sign-out-button");b.disabled=true;b.textContent="Signing out…";const {error}=await window.supabaseClient.auth.signOut();if(error){b.disabled=false;b.textContent="↪  Sign Out";setNotice("Unable to sign out. Please retry.");return;}sessionStorage.removeItem("lbis_staff_profile");location.replace("admin-login.html");});
session().then(v=>{context=v;if(context)loadExaminations();}).catch(e=>{console.error(e);setNotice("Dashboard initialization failed. Reload the page.");});
$("refresh-examinations").addEventListener("click",loadExaminations);
})();