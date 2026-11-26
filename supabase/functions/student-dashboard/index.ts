
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
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

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonPart(value: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function verifyStudentToken(token: string, signingSecret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = decodeJsonPart(parts[0]);
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const payload = decodeJsonPart(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    if (
      payload.iss !== "lbis-cbt" ||
      payload.aud !== "lbis-student" ||
      payload.role !== "student" ||
      typeof payload.sub !== "string" ||
      typeof payload.class_id !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp <= now
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, message: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("Supabase URL is not configured.");
    const publishableKey = getSecret("SUPABASE_PUBLISHABLE_KEYS");
    const serviceRoleKey = getSecret("SUPABASE_SECRET_KEYS");

    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse({ success: false, message: "Student sign-in is required. Please sign in again." }, 401);
    }

    const studentClaims = await verifyStudentToken(authorization.slice(7), serviceRoleKey);
    if (!studentClaims) {
      return jsonResponse({ success: false, message: "Your student session is invalid or has expired. Please sign in again." }, 401);
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Recheck the student and class on every dashboard request.
    const { data: student, error: studentError } = await db
      .from("students")
      .select("id, admission_number, full_name, class_id, active")
      .eq("id", studentClaims.sub)
      .maybeSingle();

    if (studentError) throw studentError;
    if (!student || student.active !== true || student.class_id !== studentClaims.class_id) {
      return jsonResponse({ success: false, message: "Your student record is no longer active. Please contact the school administrator." }, 403);
    }

    const { data: assignedClass, error: classError } = await db
      .from("classes")
      .select("id, name, level, active")
      .eq("id", student.class_id)
      .maybeSingle();

    if (classError) throw classError;
    if (!assignedClass || assignedClass.active !== true) {
      return jsonResponse({ success: false, message: "Your registered class is not currently active. Please contact the school administrator." }, 403);
    }

    const { data: examinations, error: examError } = await db
      .from("examinations")
      .select("id, title, subject, status, accepts_new_candidates, duration_minutes, starts_at, ends_at, total_marks, extracted_question_count, results_released")
      .eq("class_id", assignedClass.id)
      .in("status", ["ready", "active", "completed"])
      .order("created_at", { ascending: false });

    if (examError) throw examError;

    const examRows = examinations || [];
    const examIds = examRows.map((exam) => exam.id);
    let attempts: any[] = [];

    if (examIds.length) {
      const { data, error } = await db
        .from("exam_sessions")
        .select("id, exam_id, status, attempt_number, started_at, deadline_at, submitted_at, answered_count, score")
        .eq("student_id", student.id)
        .in("exam_id", examIds);
      if (error) throw error;
      attempts = data || [];
    }

    const attemptsByExam = new Map<string, any[]>();
    for (const attempt of attempts) {
      if (!attemptsByExam.has(attempt.exam_id)) attemptsByExam.set(attempt.exam_id, []);
      attemptsByExam.get(attempt.exam_id)!.push(attempt);
    }

    let pendingAuthorizations: any[] = [];
    if (examIds.length) {
      const { data, error } = await db
        .from("exam_retake_authorizations")
        .select("id, exam_id, status, reason, authorized_at")
        .eq("student_id", student.id)
        .in("exam_id", examIds)
        .eq("status", "pending");
      if (error) throw error;
      pendingAuthorizations = data || [];
    }

    const authorizationMap = new Map(pendingAuthorizations.map((item) => [item.exam_id, item]));
    const now = Date.now();

    const dashboardExaminations = examRows.map((exam) => {
      const examAttempts = (attemptsByExam.get(exam.id) || []).sort(
        (a, b) => Number(b.attempt_number || 0) - Number(a.attempt_number || 0),
      );

      const activeAttempt = examAttempts.find((item) => item.status === "in_progress") || null;
      const latestAttempt = activeAttempt || examAttempts[0] || null;
      const pendingAuthorization = authorizationMap.get(exam.id) || null;

      const start = exam.starts_at ? new Date(exam.starts_at).getTime() : null;
      const end = exam.ends_at ? new Date(exam.ends_at).getTime() : null;
      const scheduleOpen = (start === null || now >= start) && (end === null || now < end);

      let availability = "unavailable";
      let availability_message = "This examination is not currently available.";

      if (activeAttempt) {
        availability = "resume";
        availability_message = "You have an examination session in progress.";
      } else if (
        examAttempts.length > 0 &&
        pendingAuthorization &&
        exam.status === "active" &&
        exam.accepts_new_candidates === true &&
        scheduleOpen
      ) {
        availability = "retake_available";
        availability_message = "The school has authorised one additional attempt for you. This approval can be used once.";
      } else if (examAttempts.length > 0 && pendingAuthorization) {
        availability = "retake_waiting";
        availability_message = "A retake has been authorised, but the examination is not currently accepting candidates.";
      } else if (examAttempts.length > 0) {
        availability = "attempted";
        availability_message = latestAttempt?.status === "submitted"
          ? "You have already submitted this examination. Further attempts require individual school approval."
          : "Your previous examination attempt has ended. Contact the school if a retake is required.";
      } else if (exam.status === "completed") {
        availability = "closed";
        availability_message = "This examination has been completed.";
      } else if (exam.status === "ready") {
        availability = "upcoming";
        availability_message = "This examination is being prepared.";
      } else if (exam.status === "active" && start !== null && now < start) {
        availability = "upcoming";
        availability_message = "This examination has not started yet.";
      } else if (exam.status === "active" && end !== null && now >= end) {
        availability = "closed";
        availability_message = "The examination time window has ended.";
      } else if (exam.status === "active" && exam.accepts_new_candidates === true) {
        availability = "available";
        availability_message = "You can enter this examination.";
      } else if (exam.status === "active") {
        availability = "closed";
        availability_message = "New candidates are not currently being accepted.";
      }

      return {
        id: exam.id,
        title: exam.title,
        subject: exam.subject,
        status: exam.status,
        availability,
        availability_message,
        duration_minutes: exam.duration_minutes,
        starts_at: exam.starts_at,
        ends_at: exam.ends_at,
        total_marks: exam.total_marks,
        question_count: exam.extracted_question_count,
        attempts_count: examAttempts.length,
        attempts: examAttempts.map((item) => ({
          attempt_number: item.attempt_number,
          status: item.status,
          started_at: item.started_at,
          submitted_at: item.submitted_at,
          score: item.score,
          answered_count: item.answered_count,
        })),
        retake_authorization: pendingAuthorization ? {
          id: pendingAuthorization.id,
          authorized_at: pendingAuthorization.authorized_at,
          reason: pendingAuthorization.reason,
        } : null,
        attempt: latestAttempt ? {
          id: latestAttempt.id,
          attempt_number: latestAttempt.attempt_number,
          status: latestAttempt.status,
          started_at: latestAttempt.started_at,
          deadline_at: latestAttempt.deadline_at,
          submitted_at: latestAttempt.submitted_at,
          answered_count: latestAttempt.answered_count,
          score: latestAttempt.score,
        } : null,
      };
    });

    // Only released examinations may expose answer keys and candidate responses.
    const releasedExams=examRows.filter((exam)=>exam.results_released===true);
    const releasedLatest:any[]=[];
    for(const exam of releasedExams){
      const submitted=(attemptsByExam.get(exam.id)||[]).filter((a)=>a.status==="submitted").sort((a,b)=>Number(b.attempt_number||0)-Number(a.attempt_number||0));
      if(submitted.length)releasedLatest.push({exam,session:submitted[0]});
    }
    const releasedResults:any[]=[];
    if(releasedLatest.length){
      const releasedExamIds=releasedLatest.map((x)=>x.exam.id);
      const releasedSessionIds=releasedLatest.map((x)=>x.session.id);
      const [questionResult,answerResult]=await Promise.all([
        db.from("questions").select("id,exam_id,question_text,options,correct_option_index,marks,display_order").in("exam_id",releasedExamIds).order("display_order",{ascending:true}).limit(5000),
        db.from("answers").select("session_id,question_id,selected_option_index,is_correct,marks_awarded").in("session_id",releasedSessionIds).limit(30000),
      ]);
      if(questionResult.error)throw questionResult.error;
      if(answerResult.error)throw answerResult.error;
      const answersBySession=new Map<string,any[]>();
      for(const answer of (answerResult.data||[])){
        if(!answersBySession.has(answer.session_id))answersBySession.set(answer.session_id,[]);
        answersBySession.get(answer.session_id)!.push(answer);
      }
      const questionsByExam=new Map<string,any[]>();
      for(const question of (questionResult.data||[])){
        if(!questionsByExam.has(question.exam_id))questionsByExam.set(question.exam_id,[]);
        questionsByExam.get(question.exam_id)!.push(question);
      }
      for(const item of releasedLatest){
        const exam=item.exam,session=item.session;
        const questions=questionsByExam.get(exam.id)||[];
        const saved=answersBySession.get(session.id)||[];
        const review=questions.map((q:any,index:number)=>{
          const answer=saved.find((a:any)=>a.question_id===q.id);
          const options=Array.isArray(q.options)?q.options:[];
          const selectedIndex=answer?.selected_option_index??null;
          const correctIndex=q.correct_option_index;
          const selected=selectedIndex===null?null:(options[selectedIndex]??String(selectedIndex));
          const correct=correctIndex===null||correctIndex===undefined?"Not available":(options[correctIndex]??String(correctIndex));
          const isCorrect=selectedIndex===null?null:(answer?.is_correct??(selectedIndex===correctIndex));
          return {
            question_number:index+1,
            question_text:q.question_text,
            options,
            selected_answer:selected,
            correct_answer:correct,
            response_status:selectedIndex===null?"not_answered":(isCorrect?"correct":"incorrect"),
            marks_awarded:answer?.marks_awarded??(isCorrect?Number(q.marks||0):0),
            marks:Number(q.marks||0),
          };
        });
        const total=questions.filter((q:any)=>Array.isArray(q.options)&&q.options.length>1).reduce((sum:number,q:any)=>sum+Number(q.marks||0),0);
        const score=Number(session.score||0);
        releasedResults.push({
          exam_id:exam.id,title:exam.title,subject:exam.subject,attempt_number:session.attempt_number,
          score,total_marks:total,percentage:total>0?score/total*100:null,submitted_at:session.submitted_at,
          questions:review,
        });
      }
    }
    return jsonResponse({
      success: true,
      generated_at: new Date().toISOString(),
      student: {
        id: student.id,
        admission_number: student.admission_number,
        full_name: student.full_name,
      },
      class: {
        id: assignedClass.id,
        name: assignedClass.name,
        level: assignedClass.level,
      },
      examinations: dashboardExaminations,
      released_results: releasedResults,
    });
  } catch (error) {
    console.error("student-dashboard error:", error);
    return jsonResponse({
      success: false,
      message: "Unable to load your student dashboard. Please try again.",
    }, 500);
  }
});
