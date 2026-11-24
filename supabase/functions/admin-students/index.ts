import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function getSecret(name: string): string {
  const raw = Deno.env.get(name);
  if (!raw) throw new Error(`Missing server secret: ${name}`);
  const parsed = JSON.parse(raw);
  const value = parsed.default;
  if (typeof value !== "string" || !value) throw new Error(`Invalid server secret: ${name}`);
  return value;
}
const validUuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f-]{36}$/i.test(v);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success:false,message:"Method not allowed." },405);
  try {
    const supabaseUrl=Deno.env.get("SUPABASE_URL");
    if(!supabaseUrl)throw new Error("Supabase URL is not configured.");
    const publishableKey=getSecret("SUPABASE_PUBLISHABLE_KEYS");
    const serviceRoleKey=getSecret("SUPABASE_SECRET_KEYS");
    const authHeader=req.headers.get("Authorization");
    if(!authHeader?.startsWith("Bearer "))return jsonResponse({success:false,message:"Authentication required."},401);
    const authClient=createClient(supabaseUrl,publishableKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:authData,error:authError}=await authClient.auth.getUser(authHeader.slice(7));
    if(authError||!authData.user)return jsonResponse({success:false,message:"Your login session is invalid or expired."},401);
    const adminClient=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:profile,error:profileError}=await adminClient.from("user_profiles").select("id,role,active").eq("id",authData.user.id).single();
    if(profileError||!profile||profile.active!==true||!["admin","super_admin"].includes(profile.role))
      return jsonResponse({success:false,message:"You are not authorized to manage student records."},403);

    const body=await req.json();
    if(body.action==="list_classes"){
      const {data:classes,error}=await adminClient.from("classes").select("id,name,level,sort_order").eq("active",true).order("sort_order",{ascending:true}).order("name",{ascending:true});
      if(error)throw error;return jsonResponse({success:true,classes:classes||[]});
    }
    if(body.action==="list_students"){
      const {data:students,error}=await adminClient.from("students").select("id,admission_number,full_name,class_id,active,created_at").order("full_name",{ascending:true});
      if(error)throw error;return jsonResponse({success:true,students:students||[]});
    }
    if(body.action==="create_student"){
      const fullName=typeof body.full_name==="string"?body.full_name.trim():"";
      const admissionNumber=typeof body.admission_number==="string"?body.admission_number.trim():"";
      const classId=body.class_id===null||body.class_id===undefined||body.class_id===""?null:body.class_id;
      if(!fullName||!admissionNumber)return jsonResponse({success:false,message:"Student full name and admission number are required."},400);
      if(fullName.length>150||admissionNumber.length>60)return jsonResponse({success:false,message:"The full name or admission number is too long."},400);
      if(classId!==null&&!validUuid(classId))return jsonResponse({success:false,message:"Please select a valid class."},400);
      if(classId){const {data:selectedClass,error:classError}=await adminClient.from("classes").select("id").eq("id",classId).eq("active",true).maybeSingle();if(classError)throw classError;if(!selectedClass)return jsonResponse({success:false,message:"The selected class is unavailable. Refresh the class list and try again."},400);}
      const {data:student,error:insertError}=await adminClient.from("students").insert({admission_number:admissionNumber,full_name:fullName,class_id:classId,active:true}).select("id,admission_number,full_name,class_id,active,created_at").single();
      if(insertError){if(insertError.code==="23505")return jsonResponse({success:false,message:"That admission number already exists. Check the number and try again."},409);if(insertError.code==="23503")return jsonResponse({success:false,message:"The selected class is no longer available. Refresh the class list and try again."},400);throw insertError;}
      return jsonResponse({success:true,message:"Student added successfully.",student},201);
    }
    if(body.action==="update_student"){
      const studentId=body.student_id;
      const fullName=typeof body.full_name==="string"?body.full_name.trim():"";
      const admissionNumber=typeof body.admission_number==="string"?body.admission_number.trim():"";
      const classId=body.class_id;
      if(!validUuid(studentId))return jsonResponse({success:false,message:"Invalid student record."},400);
      if(!fullName||!admissionNumber||!validUuid(classId))return jsonResponse({success:false,message:"Full name, admission number and class are required."},400);
      if(fullName.length>150||admissionNumber.length>60)return jsonResponse({success:false,message:"The full name or admission number is too long."},400);
      const {data:selectedClass,error:classError}=await adminClient.from("classes").select("id").eq("id",classId).eq("active",true).maybeSingle();
      if(classError)throw classError;if(!selectedClass)return jsonResponse({success:false,message:"The selected class is unavailable. Refresh classes and try again."},400);
      const {data:student,error:updateError}=await adminClient.from("students").update({full_name:fullName,admission_number:admissionNumber,class_id:classId}).eq("id",studentId).select("id,admission_number,full_name,class_id,active,created_at").single();
      if(updateError){if(updateError.code==="23505")return jsonResponse({success:false,message:"That admission number is already assigned to another student."},409);if(updateError.code==="23503")return jsonResponse({success:false,message:"The selected class is no longer available."},400);throw updateError;}
      return jsonResponse({success:true,message:"Student record updated successfully.",student});
    }
    if(body.action==="set_student_active"){
      const studentId=body.student_id,active=body.active;
      if(!validUuid(studentId)||typeof active!=="boolean")return jsonResponse({success:false,message:"Invalid student status request."},400);
      const {data:student,error:updateError}=await adminClient.from("students").update({active}).eq("id",studentId).select("id,admission_number,full_name,class_id,active,created_at").single();
      if(updateError)throw updateError;
      return jsonResponse({success:true,message:active?"Student activated successfully.":"Student deactivated successfully.",student});
    }
    return jsonResponse({success:false,message:"Unknown student-management action."},400);
  } catch(error) {
    console.error("admin-students error:",error);
    return jsonResponse({success:false,message:error instanceof Error?error.message:"An unexpected server error occurred."},500);
  }
});
