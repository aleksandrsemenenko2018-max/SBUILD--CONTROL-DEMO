-- Disposable local database only. Existing S-BUILD tables are never replaced.
begin;
do $$
begin
  if to_regclass('public.sbuild_projects') is not null or to_regnamespace('auth') is not null then
    raise exception 'Use an empty disposable Postgres database';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end;
$$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
create schema sbuild_private;
grant usage on schema sbuild_private to authenticated;

create table public.sbuild_profiles (user_id uuid primary key, full_name text, role text not null, active boolean not null);
create table public.sbuild_projects (id uuid primary key);
create table public.sbuild_project_members (
  project_id uuid references public.sbuild_projects(id),
  user_id uuid references public.sbuild_profiles(user_id),
  primary key (project_id, user_id)
);
create table public.sbuild_zones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.sbuild_projects(id),
  name text,
  parent_id uuid references public.sbuild_zones(id)
);
create table public.sbuild_work_reports (
  id uuid primary key,
  zone_id uuid references public.sbuild_zones(id),
  project_id uuid references public.sbuild_projects(id),
  worker_id uuid references public.sbuild_profiles(user_id),
  status text not null
);
create function sbuild_private.can_access_project(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sbuild_profiles p where p.user_id = (select auth.uid()) and p.active
    and (p.role = 'owner' or exists (
      select 1 from public.sbuild_project_members m where m.project_id = pid and m.user_id = p.user_id
    )))
$$;
create function sbuild_private.can_manage_project(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sbuild_profiles p where p.user_id = (select auth.uid()) and p.active
    and (p.role = 'owner' or (p.role = 'foreman' and exists (
      select 1 from public.sbuild_project_members m where m.project_id = pid and m.user_id = p.user_id
    ))))
$$;
alter table public.sbuild_zones enable row level security;
grant select, insert, update on public.sbuild_zones to authenticated;
create policy zone_read on public.sbuild_zones for select to authenticated
  using (sbuild_private.can_access_project(project_id));
create policy zone_manage on public.sbuild_zones for all to authenticated
  using (sbuild_private.can_manage_project(project_id))
  with check (sbuild_private.can_manage_project(project_id));
commit;
