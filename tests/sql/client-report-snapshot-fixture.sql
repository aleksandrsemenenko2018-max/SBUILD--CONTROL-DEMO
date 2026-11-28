-- Only the disposable test schema from work-assignments-fixture.sql is extended.
begin;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role bypassrls;
  end if;
end;
$$;

create function sbuild_private.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sbuild_profiles
    where user_id = (select auth.uid()) and role = 'owner' and active
  )
$$;

alter table public.sbuild_projects
  add column name text not null,
  add column status text not null;
alter table public.sbuild_work_reports
  add column work_date date not null,
  add column description text not null,
  add column quantity numeric not null,
  add column unit text not null,
  add column worker_rate numeric not null,
  add column client_rate numeric;

insert into public.sbuild_profiles values
 ('00000000-0000-4000-8000-000000000911', 'Active owner', 'owner', true),
 ('00000000-0000-4000-8000-000000000912', 'Worker', 'worker', true),
 ('00000000-0000-4000-8000-000000000913', 'Inactive owner', 'owner', false);
insert into public.sbuild_projects values
 ('00000000-0000-4000-8000-000000000901', 'Main project', 'active'),
 ('00000000-0000-4000-8000-000000000902', 'Other project', 'active'),
 ('00000000-0000-4000-8000-000000000903', 'Closed project', 'completed');
insert into public.sbuild_zones (id, project_id, name, parent_id) values
 ('00000000-0000-4000-8000-000000000921', '00000000-0000-4000-8000-000000000901', 'Floor 1', null),
 ('00000000-0000-4000-8000-000000000922', '00000000-0000-4000-8000-000000000901', 'Room A', '00000000-0000-4000-8000-000000000921'),
 ('00000000-0000-4000-8000-000000000923', '00000000-0000-4000-8000-000000000902', 'Other project private zone', null);
insert into public.sbuild_work_reports values
 ('00000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000922', '00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000912', 'owner_approved', '2025-12-29', 'Approved work', 1.235, 'm²', 999999, 1),
 ('00000000-0000-4000-8000-000000000932', '00000000-0000-4000-8000-000000000923', '00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000912', 'owner_approved', '2026-01-04', 'Approved without price', 2, 'm²', 999999, null),
 ('00000000-0000-4000-8000-000000000933', null, '00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000912', 'foreman_approved', '2025-12-30', 'Not yet approved by owner', 3, 'h', 999999, 10),
 ('00000000-0000-4000-8000-000000000934', null, '00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000912', 'owner_approved', '2026-01-05', 'Next week', 4, 'h', 999999, 10),
 ('00000000-0000-4000-8000-000000000935', null, '00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000912', 'owner_approved', '2025-12-29', 'Other project work', 0, 'h', 999999, 10);
commit;
