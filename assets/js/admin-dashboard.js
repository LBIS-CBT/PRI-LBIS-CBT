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
  const accepting=exam.accepts_new_candidates===true,canStart=["ready","active"].includes(String(exam.status||"").toLowerCase());
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
 try{const {data,error}=await window.supabaseClient.functions.invoke("admin-examinations",{body:{action:"set_candidate_entry",exam_id:examId,accepts_new_candidates:accepting}});if(error)throw error;if(!data||data.success===false)throw new Error(data?.message||"Exam setting was not updated.");setNotice(data.message||"Examination entry setting updated.");await loadExaminations();}
 catch(err){setNotice(err.message||"Unable to update examination entry.");button.disabled=false;button.textContent=original;}
}

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
$("teacher-next").addEventListener("click",()=>{teacherPage++;renderTeachers();}});
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
$("refresh-live").addEventListener("click",()=>setNotice("Live candidate monitoring is awaiting the protected monitoring endpoint."));
$("sign-out-button").addEventListener("click",async()=>{const b=$("sign-out-button");b.disabled=true;b.textContent="Signing out…";const {error}=await window.supabaseClient.auth.signOut();if(error){b.disabled=false;b.textContent="↪  Sign Out";setNotice("Unable to sign out. Please retry.");return;}sessionStorage.removeItem("lbis_staff_profile");location.replace("admin-login.html");});
session().then(v=>{context=v;if(context)loadExaminations();}).catch(e=>{console.error(e);setNotice("Dashboard initialization failed. Reload the page.");});
$("refresh-examinations").addEventListener("click",loadExaminations);
})();