-- Synthetic schema and fixtures for a fresh isolated PostgreSQL database.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end
$$;
create schema auth;
create schema sbuild_private;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function sbuild_private.is_owner() returns boolean language sql stable as $$
  select auth.uid() = '00000000-0000-4000-8000-000000000010'
$$;
create function sbuild_private.can_access_project(project_id uuid) returns boolean language sql stable as $$
  select sbuild_private.is_owner() and project_id <> '00000000-0000-4000-8000-000000000003'
$$;

create table public.sbuild_projects (id uuid primary key, name text not null);
create table public.sbuild_work_assignments (project_id uuid, status text, due_on date);
create table public.sbuild_work_reports (project_id uuid, status text);
create table public.sbuild_questions (id int primary key, project_id uuid, status text);
create table public.sbuild_question_messages (question_id int, author_contact_id uuid);

alter table public.sbuild_projects enable row level security;
alter table public.sbuild_work_assignments enable row level security;
alter table public.sbuild_work_reports enable row level security;
alter table public.sbuild_questions enable row level security;
alter table public.sbuild_question_messages enable row level security;
create policy projects_owner on public.sbuild_projects for select to authenticated using (sbuild_private.can_access_project(id));
create policy tasks_owner on public.sbuild_work_assignments for select to authenticated using (sbuild_private.can_access_project(project_id));
create policy reports_owner on public.sbuild_work_reports for select to authenticated using (sbuild_private.can_access_project(project_id));
create policy questions_owner on public.sbuild_questions for select to authenticated using (sbuild_private.can_access_project(project_id));
create policy messages_owner on public.sbuild_question_messages for select to authenticated using (
  exists (select 1 from public.sbuild_questions issue where issue.id = question_id)
);
grant usage on schema auth,sbuild_private to authenticated;
grant select on public.sbuild_projects,public.sbuild_work_assignments,public.sbuild_work_reports,
  public.sbuild_questions,public.sbuild_question_messages to authenticated;

insert into public.sbuild_projects values
  ('00000000-0000-4000-8000-000000000001','Alpha'),
  ('00000000-0000-4000-8000-000000000002','Empty'),
  ('00000000-0000-4000-8000-000000000003','Outside scope');
insert into public.sbuild_work_assignments values
  ('00000000-0000-4000-8000-000000000001','assigned','2026-11-28'),
  ('00000000-0000-4000-8000-000000000001','in_progress','2026-11-27'),
  ('00000000-0000-4000-8000-000000000001','assigned',null),
  ('00000000-0000-4000-8000-000000000001','cancelled','2026-11-27'),
  ('00000000-0000-4000-8000-000000000001','submitted','2026-11-28'),
  ('00000000-0000-4000-8000-000000000003','assigned','2026-11-28');
insert into public.sbuild_work_reports values
  ('00000000-0000-4000-8000-000000000001','submitted'),
  ('00000000-0000-4000-8000-000000000001','foreman_approved'),
  ('00000000-0000-4000-8000-000000000001','owner_approved'),
  ('00000000-0000-4000-8000-000000000001','returned');
insert into public.sbuild_questions values
  (1,'00000000-0000-4000-8000-000000000001','draft'),
  (2,'00000000-0000-4000-8000-000000000001','sent'),
  (3,'00000000-0000-4000-8000-000000000001','sent'),
  (4,'00000000-0000-4000-8000-000000000001','answered');
insert into public.sbuild_question_messages values
  (3,'00000000-0000-4000-8000-000000000099'),
  (2,null);
