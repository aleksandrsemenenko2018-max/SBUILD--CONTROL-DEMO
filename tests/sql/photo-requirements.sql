begin;
insert into public.sbuild_projects values
 ('00000000-0000-4000-8000-000000002001'), ('00000000-0000-4000-8000-000000002002');
insert into public.sbuild_profiles values
 ('00000000-0000-4000-8000-000000002101', 'Foreman', 'foreman', true),
 ('00000000-0000-4000-8000-000000002102', 'Worker', 'worker', true);
insert into public.sbuild_project_members values
 ('00000000-0000-4000-8000-000000002001', '00000000-0000-4000-8000-000000002101'),
 ('00000000-0000-4000-8000-000000002001', '00000000-0000-4000-8000-000000002102'),
 ('00000000-0000-4000-8000-000000002002', '00000000-0000-4000-8000-000000002102');
insert into public.sbuild_work_reports values
 ('00000000-0000-4000-8000-000000002201', null, '00000000-0000-4000-8000-000000002001', '00000000-0000-4000-8000-000000002102', 'foreman_approved'),
 ('00000000-0000-4000-8000-000000002202', null, '00000000-0000-4000-8000-000000002002', '00000000-0000-4000-8000-000000002102', 'submitted');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002102', true);
do $$
begin
  begin
    perform public.sbuild_set_work_photo_requirements('00000000-0000-4000-8000-000000002201', true, true, false, false);
    raise exception 'Worker changed requirements';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.sbuild_work_photo_requirements set hidden_work = false;
    raise exception 'Worker could bypass the scoped function by writing directly';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002101', true);
do $$
declare
  own_report constant uuid := '00000000-0000-4000-8000-000000002201';
  foreign_report constant uuid := '00000000-0000-4000-8000-000000002202';
begin
  begin
    perform public.sbuild_set_work_photo_requirements(foreign_report, true, true, true, false);
    raise exception 'Foreman changed requirements for another project';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sbuild_set_work_photo_requirements(own_report, true, true, false, true);
    raise exception 'Recheck without hidden work was accepted';
  exception when check_violation then null;
  end;
  perform public.sbuild_set_work_photo_requirements(own_report, true, true, true, true);
  perform public.sbuild_set_work_photo_requirements(own_report, true, true, true, true);
  if not exists (select 1 from public.sbuild_work_photo_requirements
    where report_id = own_report and hidden_work and requires_recheck) then
    raise exception 'Existing default row was not updated';
  end if;
end;
$$;
reset role;

do $$
declare
  own_report constant uuid := '00000000-0000-4000-8000-000000002201';
begin
  if (select count(*) from public.sbuild_audit_log where actor_id = '00000000-0000-4000-8000-000000002101'
     and entity_id = own_report and details->'current'->>'hidden_work' = 'true'
     and details->'previous'->>'requires_recheck' = 'false') <> 1 then
    raise exception 'Audit missing or unchanged repeat created duplicate audit history';
  end if;
  insert into public.sbuild_work_photos values (own_report, 'before'), (own_report, 'after');
  begin
    update public.sbuild_work_reports set status = 'owner_approved' where id = own_report;
    raise exception 'Hidden work was finalized without evidence';
  exception when check_violation then null;
  end;
  insert into public.sbuild_work_photos values (own_report, 'hidden_before_close');
  begin
    update public.sbuild_work_reports set status = 'owner_approved' where id = own_report;
    raise exception 'Hidden work was finalized without required recheck';
  exception when check_violation then null;
  end;
  insert into public.sbuild_work_photos values (own_report, 'hidden_recheck');
  update public.sbuild_work_reports set status = 'owner_approved' where id = own_report;
end;
$$;
set local role authenticated;
do $$
begin
  begin
    perform public.sbuild_set_work_photo_requirements('00000000-0000-4000-8000-000000002201', true, true, false, false);
    raise exception 'Finalized report requirements were modified';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
