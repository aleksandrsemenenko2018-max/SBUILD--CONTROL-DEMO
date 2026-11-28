begin;
insert into public.sbuild_projects values
 ('00000000-0000-4000-8000-000000000101'), ('00000000-0000-4000-8000-000000000102');
insert into public.sbuild_profiles values
 ('00000000-0000-4000-8000-000000000201', 'Owner', 'owner', true),
 ('00000000-0000-4000-8000-000000000202', 'Foreman', 'foreman', true),
 ('00000000-0000-4000-8000-000000000203', 'Worker', 'worker', true),
 ('00000000-0000-4000-8000-000000000204', 'External worker', 'worker', true),
 ('00000000-0000-4000-8000-000000000205', 'Inactive worker', 'worker', false),
 ('00000000-0000-4000-8000-000000000206', 'Coworker', 'worker', true);
insert into public.sbuild_project_members values
 ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000202'),
 ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000203'),
 ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000205'),
 ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000206'),
 ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000204');
insert into public.sbuild_zones values
 ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000101'),
 ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000102'),
 ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000101');
insert into public.sbuild_work_reports values
 ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000203', 'submitted'),
 ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000206', 'submitted');

-- The foreman can assign a project colleague and see only that project's roster.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000202', true);
do $$
begin
  if (select count(*) from public.sbuild_work_assignment_roster('00000000-0000-4000-8000-000000000101')) <> 3
      or exists (select 1 from public.sbuild_work_assignment_roster('00000000-0000-4000-8000-000000000102')) then
    raise exception 'Unexpected foreman roster';
  end if;
  insert into public.sbuild_work_assignments (project_id, zone_id, assigned_to, title)
  values ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000203', 'Install partitions');
  begin
    insert into public.sbuild_work_assignments (project_id, zone_id, assigned_to, title)
    values ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000203', 'Mismatched zone');
    raise exception 'Cross-project zone was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.sbuild_work_assignments (project_id, zone_id, assigned_to, title)
    values ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000205', 'Inactive assignee');
    raise exception 'Inactive assignee was accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- Workers in or outside the project cannot read another worker's assignment.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000204', true);
do $$
begin
  if exists (select 1 from public.sbuild_work_assignments)
    or exists (select 1 from public.sbuild_work_assignment_events) then
    raise exception 'Cross-project assignment was disclosed';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000206', true);
do $$
begin
  if exists (select 1 from public.sbuild_work_assignments) then
    raise exception 'Coworker assignment was disclosed';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000203', true);
do $$
begin
  if (select count(*) from public.sbuild_work_assignments) <> 1 then
    raise exception 'Assignee cannot read own assignment';
  end if;
  begin
    update public.sbuild_work_assignments set status = 'cancelled';
    raise exception 'Worker could cancel assignment';
  exception when insufficient_privilege then null;
  end;
  update public.sbuild_work_assignments set status = 'in_progress';
  begin
    update public.sbuild_work_assignments set status = 'submitted', report_id = '00000000-0000-4000-8000-000000000402';
    raise exception 'Coworker report was accepted';
  exception when check_violation then null;
  end;
  update public.sbuild_work_assignments set status = 'submitted', report_id = '00000000-0000-4000-8000-000000000401';
  if (select count(*) from public.sbuild_work_assignment_events) <> 3 then
    raise exception 'Activity history is missing events';
  end if;
  begin
    delete from public.sbuild_work_assignment_events;
    raise exception 'Worker could delete history';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.sbuild_work_assignments set title = 'Edited after assignment';
    raise exception 'Worker could rewrite assignment details';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.sbuild_work_assignments set status = 'in_progress', report_id = null;
    raise exception 'Submitted task reopened without a returned report';
  exception when check_violation then null;
  end;
end;
$$;

-- Simulate legacy report review independently of the new assignment tables.
reset role;
do $$
begin
  begin
    update public.sbuild_work_reports set zone_id = '00000000-0000-4000-8000-000000000303'
    where id = '00000000-0000-4000-8000-000000000401';
    raise exception 'Linked report zone was changed';
  exception when check_violation then null;
  end;
  update public.sbuild_work_reports set status = 'returned'
    where id = '00000000-0000-4000-8000-000000000401';
end;
$$;
set local role authenticated;
update public.sbuild_work_assignments set status = 'in_progress', report_id = null;
do $$
begin
  if not exists (select 1 from public.sbuild_work_assignment_events
    where old_status = 'submitted' and new_status = 'in_progress'
      and report_id = '00000000-0000-4000-8000-000000000401') then
    raise exception 'Reopened task lost its previous report history';
  end if;
end;
$$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform 1 from public.sbuild_work_assignments;
    raise exception 'Anonymous read of work assignments was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
