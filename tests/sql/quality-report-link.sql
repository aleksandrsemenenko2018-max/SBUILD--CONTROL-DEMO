begin;
insert into public.sbuild_projects values ('00000000-0000-4000-8000-000000000701');
insert into public.sbuild_profiles values
 ('00000000-0000-4000-8000-000000000801', 'Owner', 'owner', true),
 ('00000000-0000-4000-8000-000000000802', 'Worker', 'worker', true),
 ('00000000-0000-4000-8000-000000000803', 'Coworker', 'worker', true);
insert into public.sbuild_project_members values
 ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000802'),
 ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000803');
insert into public.sbuild_zones (id, project_id, name) values
 ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000701', 'Zone One'),
 ('00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000701', 'Zone Two');
insert into public.sbuild_work_reports values
 ('00000000-0000-4000-8000-000000000911', '00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000802', 'foreman_approved'),
 ('00000000-0000-4000-8000-000000000912', '00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000803', 'foreman_approved');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000802', true);
do $$
declare
  project constant uuid := '00000000-0000-4000-8000-000000000701';
  zone constant uuid := '00000000-0000-4000-8000-000000000901';
  other_zone constant uuid := '00000000-0000-4000-8000-000000000902';
  report constant uuid := '00000000-0000-4000-8000-000000000911';
  other_report constant uuid := '00000000-0000-4000-8000-000000000912';
  worker constant uuid := '00000000-0000-4000-8000-000000000802';
  steps constant jsonb := '[{"text":"Check","done":false}]';
begin
  insert into public.sbuild_quality_checklists (project_id, zone_id, report_id, items, created_by)
  values (project, zone, report, steps, worker);
  begin
    insert into public.sbuild_quality_checklists (project_id, zone_id, report_id, items, created_by)
    values (project, zone, other_report, steps, worker);
    raise exception 'Worker linked another person''s report';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.sbuild_quality_checklists (project_id, zone_id, report_id, items, created_by)
    values (project, other_zone, report, steps, worker);
    raise exception 'Mismatched checklist zone was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.sbuild_quality_checklists (project_id, zone_id, report_id, items, created_by)
    values (project, zone, report, '[]', worker);
    raise exception 'Empty linked checklist was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.sbuild_quality_checklists set report_id = null;
    raise exception 'Worker detached a linked checklist';
  exception when check_violation then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000803', true);
do $$
begin
  if exists (select 1 from public.sbuild_quality_checklists) then
    raise exception 'Linked checklist was disclosed to a coworker';
  end if;
end;
$$;

reset role;
do $$
begin
  begin
    update public.sbuild_work_reports set status = 'owner_approved' where id = '00000000-0000-4000-8000-000000000911';
    raise exception 'Report was finalized without quality approval';
  exception when check_violation then null;
  end;
  begin
    update public.sbuild_work_reports set zone_id = '00000000-0000-4000-8000-000000000902'
      where id = '00000000-0000-4000-8000-000000000911';
    raise exception 'Linked report was moved to another zone';
  exception when check_violation then null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000801', true);
update public.sbuild_quality_checklists set status = 'approved', items = '[{"text":"Check","done":true}]';
reset role;
update public.sbuild_work_reports set status = 'owner_approved' where id = '00000000-0000-4000-8000-000000000911';
set local role authenticated;
do $$
begin
  begin
    update public.sbuild_quality_checklists set status = 'returned';
    raise exception 'Checklists on a finalized report were mutable';
  exception when check_violation then null;
  end;
  begin
    delete from public.sbuild_quality_checklists;
    raise exception 'A linked checklist could be deleted';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
