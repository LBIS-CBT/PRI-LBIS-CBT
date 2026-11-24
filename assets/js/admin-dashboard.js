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
session().then(v=>{context=v;}).catch(e=>{console.error(e);setNotice("Dashboard initialization failed. Reload the page.");});
})();