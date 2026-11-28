-- Preserve existing attendance and payout table formats. Route mutations through scoped, audited functions.
begin;

revoke insert, update, delete on public.sbuild_attendance_daily, public.sbuild_weekly_payouts
  from public, anon, authenticated;

create function sbuild_private.record_daily_attendance(
  pid uuid, worker uuid, day date, was_present boolean, reason text
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  attendance_id uuid;
  normalized_reason text := btrim(coalesce(reason, ''));
begin
  if actor is null or not sbuild_private.can_manage_project(pid) then
    raise insufficient_privilege using message = 'Only a project manager can record attendance';
  end if;
  if day is null or not isfinite(day) or day > timezone('Europe/Kyiv', clock_timestamp())::date
      or was_present is null or char_length(normalized_reason) > 1000 then
    raise check_violation using message = 'Invalid attendance date, presence or note';
  end if;
  if not exists (select 1 from sbuild_private.work_assignment_roster(pid) member where member.user_id = worker) then
    raise check_violation using message = 'Attendance requires an active project member';
  end if;

  insert into public.sbuild_attendance_daily as attendance (
    project_id, worker_id, work_date, present, notes, created_by
  ) values (pid, worker, day, was_present, normalized_reason, actor)
  on conflict (project_id, worker_id, work_date) do update set
    present = excluded.present, notes = excluded.notes, updated_at = clock_timestamp()
  where row(attendance.present, attendance.notes) is distinct from row(excluded.present, excluded.notes)
  returning id into attendance_id;
  if attendance_id is null then return; end if;

  insert into public.sbuild_audit_log (actor_id, entity_table, entity_id, action, details)
  values (actor, 'sbuild_attendance_daily', attendance_id, 'update',
    jsonb_build_object('project_id', pid, 'worker_id', worker, 'work_date', day, 'present', was_present));
end;
$$;
revoke execute on function sbuild_private.record_daily_attendance(uuid, uuid, date, boolean, text)
  from public, anon;
grant execute on function sbuild_private.record_daily_attendance(uuid, uuid, date, boolean, text)
  to authenticated;

create function public.sbuild_record_daily_attendance(
  p_project_id uuid, p_worker_id uuid, p_date date, p_present boolean, p_note text
)
returns void
language sql security invoker set search_path = '' as $$
  select sbuild_private.record_daily_attendance(p_project_id, p_worker_id, p_date, p_present, p_note)
$$;
revoke execute on function public.sbuild_record_daily_attendance(uuid, uuid, date, boolean, text)
  from public, anon;
grant execute on function public.sbuild_record_daily_attendance(uuid, uuid, date, boolean, text)
  to authenticated;

create index sbuild_work_reports_payroll_week_idx
  on public.sbuild_work_reports (project_id, work_date, worker_id) where status = 'owner_approved';

create function sbuild_private.work_week_totals(pid uuid, start_day date, only_worker uuid)
returns table (worker_id uuid, report_count bigint, missing_rate_count bigint, earned_amount numeric)
language sql stable security invoker set search_path = '' as $$
  select report.worker_id, count(*), count(*) filter (where report.worker_rate is null),
    round(coalesce(sum(report.quantity * report.worker_rate), 0), 2)
  from public.sbuild_work_reports report
  where report.project_id = pid and report.status = 'owner_approved'
    and report.work_date >= start_day and report.work_date < start_day + 7
    and (only_worker is null or report.worker_id = only_worker)
  group by report.worker_id
$$;
revoke execute on function sbuild_private.work_week_totals(uuid, date, uuid) from public, anon, authenticated;

create function sbuild_private.weekly_payout_summary(pid uuid, start_day date)
returns table (
  worker_id uuid, full_name text, report_count bigint, missing_rate_count bigint,
  earned_amount numeric, paid_amount numeric, paid_on date
)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  owner_access boolean := (select sbuild_private.is_owner());
begin
  if actor is null or not sbuild_private.can_access_project(pid) then
    raise insufficient_privilege using message = 'This project payroll is unavailable';
  end if;
  if start_day is null or not isfinite(start_day) or extract(isodow from start_day) <> 1 then
    raise check_violation using message = 'Select a Monday as the start of the payroll week';
  end if;
  return query
  with totals as (
    select * from sbuild_private.work_week_totals(pid, start_day, case when owner_access then null else actor end)
  ), paid as (
    select payout.worker_id, payout.amount, payout.paid_on
    from public.sbuild_weekly_payouts payout
    where payout.project_id = pid and payout.week_start = start_day and payout.status = 'paid'
      and (owner_access or payout.worker_id = actor)
  )
  select coalesce(totals.worker_id, paid.worker_id), profile.full_name,
    coalesce(totals.report_count, 0), coalesce(totals.missing_rate_count, 0),
    coalesce(totals.earned_amount, 0), paid.amount, paid.paid_on
  from totals full join paid on totals.worker_id = paid.worker_id
  left join public.sbuild_profiles profile on profile.user_id = coalesce(totals.worker_id, paid.worker_id)
  order by profile.full_name, coalesce(totals.worker_id, paid.worker_id);
end;
$$;
revoke execute on function sbuild_private.weekly_payout_summary(uuid, date) from public, anon;
grant execute on function sbuild_private.weekly_payout_summary(uuid, date) to authenticated;

create function public.sbuild_weekly_payout_summary(p_project_id uuid, p_week_start date)
returns table (
  worker_id uuid, full_name text, report_count bigint, missing_rate_count bigint,
  earned_amount numeric, paid_amount numeric, paid_on date
)
language sql stable security invoker set search_path = '' as $$
  select * from sbuild_private.weekly_payout_summary(p_project_id, p_week_start)
$$;
revoke execute on function public.sbuild_weekly_payout_summary(uuid, date) from public, anon;
grant execute on function public.sbuild_weekly_payout_summary(uuid, date) to authenticated;

create function sbuild_private.record_weekly_payout(pid uuid, worker uuid, start_day date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  today date := timezone('Europe/Kyiv', clock_timestamp())::date;
  totals record;
  payout_id uuid;
begin
  if actor is null or not sbuild_private.is_owner() then
    raise insufficient_privilege using message = 'Only the owner can record payout';
  end if;
  if worker is null or pid is null or start_day is null or not isfinite(start_day)
      or extract(isodow from start_day) <> 1 or start_day > today - 7 then
    raise check_violation using message = 'Only a finished Monday-to-Sunday period can be paid';
  end if;

  select payout.id into payout_id from public.sbuild_weekly_payouts payout
  where payout.project_id = pid and payout.worker_id = worker and payout.week_start = start_day and payout.status = 'paid';
  if found then return payout_id; end if;

  select * into totals from sbuild_private.work_week_totals(pid, start_day, worker);
  if not found or totals.missing_rate_count > 0 or totals.earned_amount <= 0 then
    raise check_violation using message = 'Approved work with complete payable rates is required';
  end if;

  insert into public.sbuild_weekly_payouts as payout (
    project_id, worker_id, week_start, amount, status, paid_on, recorded_by
  ) values (
    pid, worker, start_day, totals.earned_amount, 'paid', today, actor
  )
  on conflict (project_id, worker_id, week_start) do update set
    amount = excluded.amount, status = 'paid', paid_on = excluded.paid_on,
    recorded_by = actor, updated_at = clock_timestamp()
  where payout.status = 'planned'
  returning id into payout_id;

  if payout_id is null then
    select payout.id into payout_id from public.sbuild_weekly_payouts payout
    where payout.project_id = pid and payout.worker_id = worker and payout.week_start = start_day;
    return payout_id;
  end if;

  insert into public.sbuild_audit_log (actor_id, entity_table, entity_id, action, details)
  values (actor, 'sbuild_weekly_payouts', payout_id, 'update',
    jsonb_build_object('project_id', pid, 'worker_id', worker, 'week_start', start_day,
      'amount', totals.earned_amount, 'paid_on', today));
  return payout_id;
end;
$$;
revoke execute on function sbuild_private.record_weekly_payout(uuid, uuid, date) from public, anon;
grant execute on function sbuild_private.record_weekly_payout(uuid, uuid, date) to authenticated;

create function public.sbuild_record_weekly_payout(p_project_id uuid, p_worker_id uuid, p_week_start date)
returns uuid language sql security invoker set search_path = '' as $$
  select sbuild_private.record_weekly_payout(p_project_id, p_worker_id, p_week_start)
$$;
revoke execute on function public.sbuild_record_weekly_payout(uuid, uuid, date) from public, anon;
grant execute on function public.sbuild_record_weekly_payout(uuid, uuid, date) to authenticated;

notify pgrst, 'reload schema';
commit;
