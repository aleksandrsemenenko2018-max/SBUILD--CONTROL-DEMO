begin;
do $$
begin
  assert not has_function_privilege('anon','public.sbuild_owner_daily_summary(date,uuid)','EXECUTE'),
    'anonymous role cannot run this summary';
end
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
do $$
begin
  begin
    perform 1 from public.sbuild_owner_daily_summary('2026-11-28');
    raise exception 'non-owner obtained the owner summary';
  exception when insufficient_privilege then null;
  end;
end
$$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
do $$
declare
  digest record;
begin
  assert (select count(*) from public.sbuild_owner_daily_summary('2026-11-28')) = 2, 'only accessible projects';
  assert (select count(*) from public.sbuild_owner_daily_summary('2026-11-28','00000000-0000-4000-8000-000000000003')) = 0,
    'explicit inaccessible project ID returns no data';
  select * into strict digest
    from public.sbuild_owner_daily_summary('2026-11-28','00000000-0000-4000-8000-000000000001');
  assert digest.summary_day = '2026-11-28' and digest.project_name = 'Alpha', 'correct date and project';
  assert digest.open_tasks = 3 and digest.tasks_due_today = 1 and digest.overdue_tasks = 1, 'open tasks by due date';
  assert digest.reports_waiting_foreman = 1 and digest.reports_waiting_owner = 1, 'approval queue stages';
  assert digest.issue_drafts = 1 and digest.issues_waiting_reply = 1, 'replied or answered issues excluded';

  select * into strict digest
    from public.sbuild_owner_daily_summary('2026-11-28','00000000-0000-4000-8000-000000000002');
  assert (digest.open_tasks, digest.tasks_due_today, digest.overdue_tasks,
    digest.reports_waiting_foreman, digest.reports_waiting_owner, digest.issue_drafts, digest.issues_waiting_reply)
    = (0,0,0,0,0,0,0), 'empty projects have explicit zero counts';

  begin
    perform 1 from public.sbuild_owner_daily_summary(null);
    raise exception 'invalid date accepted';
  exception when invalid_parameter_value then null;
  end;
end
$$;
rollback;
