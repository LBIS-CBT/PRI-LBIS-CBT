(() => {
"use strict";
const $=id=>document.getElementById(id);
const layout=$("teacher-layout"),unsupported=$("unsupported-device"),message=$("teacher-dashboard-message");
if(!layout)return;
if(window.matchMedia("(max-width: 600px)").matches){unsupported.hidden=false;return;}
const say=t=>{message.textContent=t||"";};
const roleNames={teacher:"Teacher",admin:"Administrator",super_admin:"Super Administrator"};
function showPanel(name){
 document.querySelectorAll(".teacher-panel").forEach(p=>p.classList.toggle("active",p.id==="teacher-panel-"+name));
 document.querySelectorAll(".teacher-nav-button").forEach(b=>b.classList.toggle("active",b.dataset.panel===name));
 const titles={overview:"Teacher Overview","create-exam":"Create Examination","my-exams":"My Examinations","question-bank":"Question Extraction"};
 $("teacher-page-title").textContent=titles[name]||"Teacher Dashboard";
 say("");
}
document.querySelectorAll("[data-panel]").forEach(b=>b.addEventListener("click",()=>showPanel(b.dataset.panel)));
document.querySelectorAll("[data-open-panel]").forEach(b=>b.addEventListener("click",()=>showPanel(b.dataset.openPanel)));
async function init(){
 if(!window.supabaseClient){say("The secure connection could not be initialized. Reload this page.");return;}
 const {data,error}=await window.supabaseClient.auth.getSession();
 if(error||!data?.session){location.replace("admin-login.html");return;}
 const {data:profile,error:profileError}=await window.supabaseClient.from("user_profiles").select("id,full_name,staff_code,role,active").eq("id",data.session.user.id).single();
 if(profileError||!profile){say("Your staff profile could not be loaded. Contact the school CBT administrator.");return;}
 if(profile.active!==true){await window.supabaseClient.auth.signOut();sessionStorage.removeItem("lbis_staff_profile");location.replace("admin-login.html");return;}
 if(profile.role!=="teacher"){location.replace(profile.role==="admin"||profile.role==="super_admin"?"admin-dashboard.html":"admin-login.html");return;}
 const name=profile.full_name||"Teacher";
 $("teacher-name").textContent=name;$("teacher-top-name").textContent=name;$("teacher-code").textContent=profile.staff_code||"—";
 $("teacher-avatar").textContent=name.trim().split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase()||"T";
 $("teacher-exam-count").textContent="—";
}
$("teacher-sign-out").addEventListener("click",async()=>{const b=$("teacher-sign-out");b.disabled=true;b.textContent="Signing out…";const {error}=await window.supabaseClient.auth.signOut();if(error){b.disabled=false;b.textContent="↪  Sign Out";say("Unable to sign out. Please try again.");return;}sessionStorage.removeItem("lbis_staff_profile");location.replace("admin-login.html");});
init().catch(e=>{console.error("Teacher dashboard:",e);say("The teacher dashboard could not be loaded. Refresh the page.");});
})();