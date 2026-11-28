begin;
insert into public.sbuild_projects values
 ('00000000-0000-4000-8000-000000004001'), ('00000000-0000-4000-8000-000000004002');
insert into public.sbuild_profiles values
 ('00000000-0000-4000-8000-000000004101', 'Owner', 'owner', true),
 ('00000000-0000-4000-8000-000000004102', 'Foreman', 'foreman', true),
 ('00000000-0000-4000-8000-000000004103', 'Worker', 'worker', true),
 ('00000000-0000-4000-8000-000000004104', 'Coworker', 'worker', true),
 ('00000000-0000-4000-8000-000000004105', 'External worker', 'worker', true);
insert into public.sbuild_project_members values
 ('00000000-0000-4000-8000-000000004001', '00000000-0000-4000-8000-000000004102'),
 ('00000000-0000-4000-8000-000000004001', '00000000-0000-4000-8000-000000004103'),
 ('00000000-0000-4000-8000-000000004001', '00000000-0000-4000-8000-000000004104'),
 ('00000000-0000-4000-8000-000000004002', '00000000-0000-4000-8000-000000004105');
insert into public.sbuild_work_reports (id,project_id,worker_id,status,work_date,quantity,worker_rate) values
 ('00000000-0000-4000-8000-000000004201', '00000000-0000-4000-8000-000000004001', '00000000-0000-4000-8000-000000004103', 'owner_approved', '2025-06-09', 2, 100),
 ('00000000-0000-4000-8000-000000004202', '00000000-0000-4000-8000-000000004001', '00000000-0000-4000-8000-000000004103', 'owner_approved', '2025-06-15', 1.25, 80),
 ('00000000-0000-4000-8000-000000004203', '00000000-0000-4000-8000-000000004001', '00000000-0000-4000-8000-000000004103', 'submitted', '2025-06-13', 9, 1000),
 ('00000000-0000-4000-8000-000000004204', '00000000-0000-4000-8000-000000004001', '00000000-0000-4000-8000-000000004103', 'owner_approved', '2025-06-16', 9, 1000),
 ('00000000-0000-4000-8000-000000004205', '00000000-0000-4000-8000-000000004001', '00000000-0000-4000-8000-000000004104', 'owner_approved', '2025-06-10', 1, null),
 ('00000000-0000-4000-8000-000000004206', '00000000-0000-4000-8000-000000004002', '00000000-0000-4000-8000-000000004105', 'owner_approved', '2025-06-12', 5, 80);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004102', true);
do $$
declare
  project constant uuid := '00000000-0000-4000-8000-000000004001';
  worker constant uuid := '00000000-0000-4000-8000-000000004103';
  outsider constant uuid := '00000000-0000-4000-8000-000000004105';
begin
  perform public.sbuild_record_daily_attendance(project, worker, '2025-06-10', true, ' initial ');
  perform public.sbuild_record_daily_attendance(project, worker, '2025-06-10', false, 'revised');
  perform public.sbuild_record_daily_attendance(project, worker, '2025-06-10', false, 'revised');
  if (select count(*) from public.sbuild_attendance_daily where worker_id = worker) <> 1
     or not exists (select 1 from public.sbuild_attendance_daily where worker_id = worker and not present and notes = 'revised') then
    raise exception 'Attendance did not update a single day';
  end if;
  begin
    perform public.sbuild_record_daily_attendance(project, outsider, '2025-06-10', true, '');
    raise exception 'A nonmember attendance entry was allowed';
  exception when check_violation then null;
  end;
  begin
    perform public.sbuild_record_daily_attendance(project, worker, 'infinity', true, '');
    raise exception 'Infinite attendance date accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.sbuild_record_weekly_payout(project, worker, '2025-06-09');
    raise exception 'Foreman could record payouts';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004103', true);
do $$
declare
  project constant uuid := '00000000-0000-4000-8000-000000004001';
  external_project constant uuid := '00000000-0000-4000-8000-000000004002';
  own_id constant uuid := '00000000-0000-4000-8000-000000004103';
begin
  if (select count(*) from public.sbuild_weekly_payout_summary(project, '2025-06-09')) <> 1
     or not exists (select 1 from public.sbuild_weekly_payout_summary(project, '2025-06-09')
       where worker_id = own_id and earned_amount = 300 and paid_amount is null and report_count = 2) then
    raise exception 'Worker cannot read own approved totals or can read others';
  end if;
  begin
    perform public.sbuild_weekly_payout_summary(external_project, '2025-06-09');
    raise exception 'Worker read another project payroll';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sbuild_record_daily_attendance(project, own_id, '2025-06-10', true, 'changed');
    raise exception 'Worker could change verified attendance';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004101', true);
do $$
declare
  project constant uuid := '00000000-0000-4000-8000-000000004001';
  worker constant uuid := '00000000-0000-4000-8000-000000004103';
  incomplete constant uuid := '00000000-0000-4000-8000-000000004104';
  payment uuid;
begin
  begin
    perform public.sbuild_record_weekly_payout(project, worker, '2025-06-10');
    raise exception 'A non-Monday payout was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.sbuild_record_weekly_payout(project, worker, '2099-01-05');
    raise exception 'A future payout was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.sbuild_record_weekly_payout(project, incomplete, '2025-06-09');
    raise exception 'Incomplete approved rates could be paid';
  exception when check_violation then null;
  end;
  payment := public.sbuild_record_weekly_payout(project, worker, '2025-06-09');
  if payment is null or public.sbuild_record_weekly_payout(project, worker, '2025-06-09') is distinct from payment
     or not exists (select 1 from public.sbuild_weekly_payouts where id = payment and amount = 300 and status = 'paid') then
    raise exception 'The approved amount or idempotent payout was incorrect';
  end if;
  begin
    update public.sbuild_weekly_payouts set amount = 1;
    raise exception 'Direct modification of recorded payment was possible';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

insert into public.sbuild_work_reports (id,project_id,worker_id,status,work_date,quantity,worker_rate)
values ('00000000-0000-4000-8000-000000004207', '00000000-0000-4000-8000-000000004001',
 '00000000-0000-4000-8000-000000004103', 'owner_approved', '2025-06-14', 1, 50);
do $$
begin
  if (select count(*) from public.sbuild_audit_log where entity_table = 'sbuild_attendance_daily') <> 2
    or (select count(*) from public.sbuild_audit_log where entity_table = 'sbuild_weekly_payouts') <> 1 then
    raise exception 'Audit missing or repeat requests created duplicate history';
  end if;
end;
$$;
set local role authenticated;
do $$
begin
  if not exists (
    select 1 from public.sbuild_weekly_payout_summary('00000000-0000-4000-8000-000000004001', '2025-06-09')
    where worker_id = '00000000-0000-4000-8000-000000004103' and earned_amount = 350 and paid_amount = 300
  ) then
    raise exception 'Late approval changed stored payment or was omitted from the balance';
  end if;
end;
$$;
rollback;
