-- Use the existing optional report_id while enforcing report ownership and completion.
begin;

create index sbuild_quality_report_status_idx
  on public.sbuild_quality_checklists (report_id, status) where report_id is not null;

create function sbuild_private.can_read_report_quality(pid uuid, rid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select sbuild_private.can_manage_project(pid) or (
    sbuild_private.can_access_project(pid) and exists (
      select 1 from public.sbuild_work_reports report
      where report.id = rid and report.project_id = pid and report.worker_id = (select auth.uid())
    )
  )
$$;
revoke execute on function sbuild_private.can_read_report_quality(uuid, uuid) from public, anon;
grant execute on function sbuild_private.can_read_report_quality(uuid, uuid) to authenticated;
create policy quality_linked_report_read on public.sbuild_quality_checklists as restrictive
  for select to authenticated using (
    report_id is null or sbuild_private.can_read_report_quality(project_id, report_id)
  );

create function sbuild_private.enforce_quality_report_link()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  report public.sbuild_work_reports%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.report_id is not null then
      raise check_violation using message = 'A linked quality checklist cannot be deleted';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.report_id is not null and new.report_id is distinct from old.report_id then
    raise check_violation using message = 'The linked work report cannot be changed';
  end if;
  if new.report_id is null then return new; end if;

  select linked.* into report from public.sbuild_work_reports linked
  where linked.id = new.report_id for no key update;
  if not found or not sbuild_private.can_access_project(new.project_id)
      or report.project_id is distinct from new.project_id
      or (report.worker_id is distinct from (select auth.uid())
          and not sbuild_private.can_manage_project(new.project_id)) then
    raise insufficient_privilege using message = 'The linked work report is unavailable';
  end if;
  if report.zone_id is distinct from new.zone_id then
    raise check_violation using message = 'The checklist zone must match the linked work report';
  end if;
  if report.status = 'owner_approved' then
    raise check_violation using message = 'The finalized work report and its checklists are immutable';
  end if;
  if jsonb_typeof(new.items) is distinct from 'array' then
    raise check_violation using message = 'Quality checks must be sent as an array';
  end if;
  if jsonb_array_length(new.items) = 0 then
    raise check_violation using message = 'A linked quality checklist needs at least one check';
  end if;
  return new;
end;
$$;
revoke execute on function sbuild_private.enforce_quality_report_link() from public, anon, authenticated;
create trigger enforce_quality_report_link before insert or update or delete on public.sbuild_quality_checklists
  for each row execute function sbuild_private.enforce_quality_report_link();

create function sbuild_private.enforce_report_quality_completion()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.zone_id is distinct from old.zone_id and exists (
    select 1 from public.sbuild_quality_checklists checklist where checklist.report_id = old.id
  ) then
    raise check_violation using message = 'A report with a linked checklist must remain in its original zone';
  end if;
  if new.status = 'owner_approved' and old.status is distinct from new.status and exists (
    select 1 from public.sbuild_quality_checklists checklist
    where checklist.report_id = old.id and checklist.status is distinct from 'approved'
  ) then
    raise check_violation using message = 'Approve all linked quality checklists before final work approval';
  end if;
  return new;
end;
$$;
revoke execute on function sbuild_private.enforce_report_quality_completion() from public, anon, authenticated;
create trigger enforce_report_quality_completion before update of status, zone_id on public.sbuild_work_reports
  for each row execute function sbuild_private.enforce_report_quality_completion();

commit;
