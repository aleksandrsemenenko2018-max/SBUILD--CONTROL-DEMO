-- Load only into a fresh isolated test database as its administrator.
do $$ begin
  if to_regnamespace('auth') is not null then
    raise exception 'Use a new disposable PostgreSQL database';
  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create schema storage;
create schema sbuild_private;

create function auth.uid() returns uuid language sql stable
as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
create function storage.foldername(name text) returns text[] language sql immutable
as $$select (string_to_array(name, '/'))[1:cardinality(string_to_array(name, '/'))-1]$$;
create function sbuild_private.is_owner() returns boolean language sql stable
as $$select coalesce(auth.uid() = '00000000-0000-4000-8000-000000000010',false)$$;
create function sbuild_private.can_access_project(id uuid) returns boolean language sql stable as $$
  select sbuild_private.is_owner() or coalesce(
    auth.uid() in ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012')
      and id = '00000000-0000-4000-8000-000000000001'
    or auth.uid() = '00000000-0000-4000-8000-000000000013'
      and id = '00000000-0000-4000-8000-000000000002', false)
$$;

create table public.sbuild_project_contacts (
  id uuid primary key, project_id uuid not null, role text not null,
  name text default 'Test contact', phone text, created_at timestamptz default now(),
  telegram_chat_id text, link_code uuid default '00000000-0000-4000-8000-000000000060'
);
create table public.sbuild_questions (
  id uuid primary key, project_id uuid not null, created_by uuid not null,
  recipient_contact_id uuid not null, recipient_role text not null, status text not null
);
create table public.sbuild_question_messages (
  id uuid primary key, question_id uuid not null, author_user_id uuid,
  author_contact_id uuid, media_path text
);
create table storage.objects (
  bucket_id text not null, name text not null, primary key(bucket_id,name)
);
alter table public.sbuild_project_contacts enable row level security;
alter table public.sbuild_questions enable row level security;
alter table public.sbuild_question_messages enable row level security;
alter table storage.objects enable row level security;

grant usage on schema auth, storage, sbuild_private to authenticated;
grant select, insert, update on public.sbuild_project_contacts, public.sbuild_questions,
  public.sbuild_question_messages, storage.objects to authenticated;

-- Match the permissive policy names this migration replaces.
create policy "contacts authenticated read" on public.sbuild_project_contacts for select to authenticated using (true);
create policy "questions authenticated read" on public.sbuild_questions for select to authenticated using (true);
create policy "questions authenticated insert" on public.sbuild_questions for insert to authenticated with check (true);
create policy "messages authenticated read" on public.sbuild_question_messages for select to authenticated using (true);
create policy "messages authenticated insert" on public.sbuild_question_messages for insert to authenticated with check (true);
create policy "sbuild media read" on storage.objects for select to authenticated using (bucket_id = 'sbuild-question-media');
create policy "sbuild media upload" on storage.objects for insert to authenticated with check (bucket_id = 'sbuild-question-media');

insert into public.sbuild_project_contacts values
  ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','designer'),
  ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000002','customer');
update public.sbuild_project_contacts set telegram_chat_id='synthetic-chat-id' where role='customer';
insert into public.sbuild_questions values
  ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','designer','draft'),
  ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000022','customer','sent');
insert into public.sbuild_question_messages values
  ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000011',null,'00000000-0000-4000-8000-000000000011/00000000-0000-4000-8000-000000000031/linked.pdf'),
  ('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000032',null,'00000000-0000-4000-8000-000000000022','legacy-reply.pdf');
insert into storage.objects values
  ('sbuild-question-media','00000000-0000-4000-8000-000000000011/00000000-0000-4000-8000-000000000031/linked.pdf'),
  ('sbuild-question-media','00000000-0000-4000-8000-000000000011/00000000-0000-4000-8000-000000000031/pending.pdf'),
  ('sbuild-question-media','legacy-reply.pdf');

alter table public.sbuild_question_messages alter column id set default gen_random_uuid();
alter table public.sbuild_question_messages add column telegram_message_id bigint;
alter table public.sbuild_question_messages add column body text;
alter table public.sbuild_question_messages add column media_type text;
create table public.sbuild_telegram_deliveries (
  question_id uuid not null, contact_id uuid not null, chat_id text not null, telegram_message_id bigint not null
);
grant select, update on public.sbuild_questions, public.sbuild_project_contacts to service_role;
grant select, insert on public.sbuild_question_messages, public.sbuild_telegram_deliveries to service_role;
