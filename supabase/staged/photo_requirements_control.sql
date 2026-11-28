-- Allow authorized project managers to configure an existing set of photo requirements.
begin;

-- Default requirements are inserted by the existing work-report trigger.
-- All interactive changes use the scoped function and acquire the report lock.
revoke insert, update, delete on public.sbuild_work_photo_requirements from public, anon, authenticated;

create function sbuild_private.set_work_photo_requirements(
  rid uuid, before_required boolean, after_required boolean, hidden_required boolean, recheck_required boolean
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  report_status text;
  previous_rules jsonb;
  next_rules jsonb;
begin
  select report.status into report_status from public.sbuild_work_reports report
  where report.id = rid and actor is not null and sbuild_private.can_manage_project(report.project_id)
  for no key update;
  if not found then
    raise insufficient_privilege using message = 'Only a project manager can change photo requirements';
  end if;
  if report_status = 'owner_approved' then
    raise check_violation using message = 'Photo requirements are immutable after final approval';
  end if;
  if before_required is null or after_required is null or hidden_required is null or recheck_required is null then
    raise check_violation using message = 'All photo requirement flags are required';
  end if;
  if recheck_required and not hidden_required then
    raise check_violation using message = 'A recheck requires hidden-work photo evidence';
  end if;

  select jsonb_build_object(
    'required_before', rule.required_before, 'required_after', rule.required_after,
    'hidden_work', rule.hidden_work, 'requires_recheck', rule.requires_recheck
  ) into previous_rules
  from public.sbuild_work_photo_requirements rule where rule.report_id = rid;
  next_rules := jsonb_build_object(
    'required_before', before_required, 'required_after', after_required,
    'hidden_work', hidden_required, 'requires_recheck', recheck_required
  );
  if next_rules is not distinct from previous_rules then return; end if;

  insert into public.sbuild_work_photo_requirements (
    report_id, required_before, required_after, hidden_work, requires_recheck
  ) values (rid, before_required, after_required, hidden_required, recheck_required)
  on conflict (report_id) do update set
    required_before = excluded.required_before,
    required_after = excluded.required_after,
    hidden_work = excluded.hidden_work,
    requires_recheck = excluded.requires_recheck;

  insert into public.sbuild_audit_log (actor_id, entity_table, entity_id, action, details)
  values (actor, 'sbuild_work_photo_requirements', rid, 'update',
    jsonb_build_object('previous', previous_rules, 'current', next_rules));
end;
$$;
revoke execute on function sbuild_private.set_work_photo_requirements(uuid, boolean, boolean, boolean, boolean)
  from public, anon;
grant execute on function sbuild_private.set_work_photo_requirements(uuid, boolean, boolean, boolean, boolean)
  to authenticated;

create function public.sbuild_set_work_photo_requirements(
  p_report_id uuid, p_required_before boolean, p_required_after boolean, p_hidden_work boolean, p_requires_recheck boolean
)
returns void
language sql security invoker set search_path = '' as $$
  select sbuild_private.set_work_photo_requirements(
    p_report_id, p_required_before, p_required_after, p_hidden_work, p_requires_recheck
  )
$$;
revoke execute on function public.sbuild_set_work_photo_requirements(uuid, boolean, boolean, boolean, boolean)
  from public, anon;
grant execute on function public.sbuild_set_work_photo_requirements(uuid, boolean, boolean, boolean, boolean)
  to authenticated;

notify pgrst, 'reload schema';
commit;
