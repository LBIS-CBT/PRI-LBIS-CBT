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
}
document.querySelectorAll("[data-panel]").forEach(b=>b.addEventListener("click",()=>showPanel(b.dataset.panel)));
async function session(){
 if(!window.supabaseClient){setNotice("Secure connection unavailable. Reload this page.");return null;}
 const {data,error}=await window.supabaseClient.auth.getSession();
 if(error||!data.session){location.replace("admin-login.html");return null;}
 const {data:p,error:e}=await window.supabaseClient.from("user_profiles").select("id,full_name,staff_code,role,active").eq("id",data.session.user.id).single();
 if(e||!p||!p.active){await window.supabaseClient.auth.signOut();location.replace("admin-login.html");return null;}
 if(!["admin","super_admin"].includes(p.role)){location.replace("staff-dashboard.html");return null;}
 $("staff-name").textContent=p.full_name||"Administrator";$("staff-code").textContent=p.staff_code||"—";
 $("staff-role").textContent=label(p.role);$("profile-role").textContent=label(p.role);
 $("top-user").textContent=p.full_name||p.staff_code||"Administrator";
 $("user-initials").textContent=(p.full_name||"LB").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
 return {profile:p,session:data.session};
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
$("reload-teachers").addEventListener("click",async()=>{
 if(!context)return;const area=$("teachers-content");area.textContent="Loading staff records…";
 try{
  const {data,error}=await window.supabaseClient.functions.invoke("staff-management",{body:{action:"list_staff"}});
  if(error)throw error;if(!data||data.success===false)throw new Error(data?.message||"Unable to retrieve staff.");
  const staff=data.staff||data.users||data.data||[];
  if(!staff.length){area.textContent="No staff records were returned.";return;}
  const table=document.createElement("table");table.className="staff-table";
  const head=document.createElement("tr");["Name","Staff Code","Role","Status"].forEach(t=>{const th=document.createElement("th");th.textContent=t;head.appendChild(th);});table.appendChild(head);
  staff.forEach(s=>{const tr=document.createElement("tr");[s.full_name||s.name||"—",s.staff_code||"—",label(s.role),s.active===false?"Inactive":"Active"].forEach(t=>{const td=document.createElement("td");td.textContent=t;tr.appendChild(td);});table.appendChild(tr);});
  area.replaceChildren(table);
 }catch(err){area.textContent=err.message||"Staff list could not be loaded.";}
});
$("refresh-live").addEventListener("click",()=>setNotice("Live candidate monitoring is awaiting the protected monitoring endpoint."));
$("sign-out-button").addEventListener("click",async()=>{const b=$("sign-out-button");b.disabled=true;b.textContent="Signing out…";const {error}=await window.supabaseClient.auth.signOut();if(error){b.disabled=false;b.textContent="↪  Sign Out";setNotice("Unable to sign out. Please retry.");return;}sessionStorage.removeItem("lbis_staff_profile");location.replace("admin-login.html");});
session().then(v=>{context=v;if(context)loadExaminations();}).catch(e=>{console.error(e);setNotice("Dashboard initialization failed. Reload the page.");});
$("refresh-examinations").addEventListener("click",loadExaminations);
})();