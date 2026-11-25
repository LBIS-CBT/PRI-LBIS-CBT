-- LBIS CBT: safely remove an unused teacher examination.
-- The examination row is locked before checking sessions. This serializes deletion
-- against session creation through the exam_sessions.exam_id foreign key.
-- Any restrictive dependent foreign key aborts the transaction; cascading
-- relationships are handled by the database's existing FK rules.
create or replace function public.lbis_teacher_delete_unused_examination(
  p_exam_id uuid,
  p_teacher_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_title text;
  v_attempt_count bigint;
begin
  select e.title
    into v_title
    from public.examinations e
   where e.id = p_exam_id
     and e.created_by = p_teacher_id
   for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'code', 'NOT_FOUND',
      'message', 'Examination not found or it does not belong to your teacher account.'
    );
  end if;

  select count(*)
    into v_attempt_count
    from public.exam_sessions s
   where s.exam_id = p_exam_id;

  if v_attempt_count > 0 then
    return jsonb_build_object(
      'success', false,
      'code', 'HAS_ATTEMPTS',
      'message', 'This examination has candidate sessions or attempt history and cannot be deleted. Student attempts and results have been preserved.'
    );
  end if;

  delete from public.examinations e
   where e.id = p_exam_id
     and e.created_by = p_teacher_id;

  return jsonb_build_object(
    'success', true,
    'title', v_title
  );
exception
  when foreign_key_violation then
    raise exception 'This examination has dependent records that prevent safe deletion. No records were deleted.';
end;
$$;

revoke all on function public.lbis_teacher_delete_unused_examination(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lbis_teacher_delete_unused_examination(uuid, uuid) to service_role;
