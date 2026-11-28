begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001201', true);
do $$
begin
  begin
    insert into public.sbuild_work_assignments (project_id, zone_id, assigned_to, title, instruction_text)
    values ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000001301',
      '00000000-0000-4000-8000-000000001202', 'Missing instructions', '   ');
    raise exception 'Issuing a new task without instructions succeeded';
  exception when check_violation then null;
  end;
end;
$$;
insert into public.sbuild_work_assignments (project_id, zone_id, assigned_to, title, instruction_text)
values ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000001301',
        '00000000-0000-4000-8000-000000001202', 'Install per plan', 'Follow the signed site method statement.');
select set_config(
  'sbuild_test.assignment_id',
  (select id::text from public.sbuild_work_assignments where title = 'Install per plan'),
  true
);
do $$
begin
  begin
    insert into public.sbuild_work_assignment_acknowledgements (assignment_id)
      values (current_setting('sbuild_test.assignment_id')::uuid);
    raise exception 'Owner acknowledged a worker instruction';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001203', true);
do $$
begin
  begin
    insert into public.sbuild_work_assignment_acknowledgements (assignment_id)
      values (current_setting('sbuild_test.assignment_id')::uuid);
    raise exception 'Coworker acknowledged a worker instruction';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001202', true);
do $$
declare
  task_id constant uuid := current_setting('sbuild_test.assignment_id')::uuid;
begin
  update public.sbuild_work_assignments set status = 'in_progress' where title = 'Legacy task';
  if not exists (select 1 from public.sbuild_work_assignments where title = 'Legacy task' and status = 'in_progress') then
    raise exception 'Legacy task was blocked';
  end if;
  begin
    update public.sbuild_work_assignments set status = 'in_progress' where id = task_id;
    raise exception 'Worker started a task before acknowledgement';
  exception when check_violation then null;
  end;
  begin
    insert into public.sbuild_work_assignment_acknowledgements (assignment_id, acknowledged_at)
      values (task_id, '2000-01-01'::timestamptz);
    raise exception 'Worker could set acknowledgement timestamp';
  exception when insufficient_privilege then null;
  end;
  insert into public.sbuild_work_assignment_acknowledgements (assignment_id) values (task_id);
  if not exists (select 1 from public.sbuild_work_assignment_acknowledgements
      where assignment_id = task_id and actor_id = auth.uid() and acknowledged_at >= transaction_timestamp()) then
    raise exception 'Acknowledgement did not store the actual worker and server time';
  end if;
  begin
    insert into public.sbuild_work_assignment_acknowledgements (assignment_id) values (task_id);
    raise exception 'Duplicate acknowledgement was accepted';
  exception when unique_violation then null;
  end;
  update public.sbuild_work_assignments set status = 'in_progress' where id = task_id;
  if not exists (select 1 from public.sbuild_work_assignments where id = task_id and status = 'in_progress') then
    raise exception 'Worker could not start after acknowledgement';
  end if;
  begin
    delete from public.sbuild_work_assignment_acknowledgements where assignment_id = task_id;
    raise exception 'Worker could delete acknowledgement';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001203', true);
do $$
begin
  if exists (select 1 from public.sbuild_work_assignment_acknowledgements) then
    raise exception 'Acknowledgement was disclosed to another worker';
  end if;
end;
$$;
rollback;
