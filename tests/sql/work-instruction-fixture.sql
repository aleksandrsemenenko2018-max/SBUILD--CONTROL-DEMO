-- Deploy the existing assignment workflow, then issue one test task before adding instructions.
begin;
insert into public.sbuild_projects values ('00000000-0000-4000-8000-000000001001');
insert into public.sbuild_profiles values
 ('00000000-0000-4000-8000-000000001201', 'Owner', 'owner', true),
 ('00000000-0000-4000-8000-000000001202', 'Worker', 'worker', true),
 ('00000000-0000-4000-8000-000000001203', 'Coworker', 'worker', true);
insert into public.sbuild_project_members values
 ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000001202'),
 ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000001203');
insert into public.sbuild_zones (id, project_id, name) values
 ('00000000-0000-4000-8000-000000001301', '00000000-0000-4000-8000-000000001001', 'Zone');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001201', true);
insert into public.sbuild_work_assignments (project_id, zone_id, assigned_to, title)
values ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000001301',
        '00000000-0000-4000-8000-000000001202', 'Legacy task');
commit;
