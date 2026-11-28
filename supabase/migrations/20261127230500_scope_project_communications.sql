-- Scope S-BUILD communications and attachment objects to authorized projects.
-- Prepare and test in an isolated database before any production deployment.
begin;

drop policy if exists "contacts authenticated read" on public.sbuild_project_contacts;
drop policy if exists "contacts owner write" on public.sbuild_project_contacts;
create policy contacts_project_read on public.sbuild_project_contacts
  for select to authenticated using (sbuild_private.can_access_project(project_id));
create policy contacts_owner_manage on public.sbuild_project_contacts
  for all to authenticated
  using (sbuild_private.is_owner() and sbuild_private.can_access_project(project_id))
  with check (sbuild_private.is_owner() and sbuild_private.can_access_project(project_id));

drop policy if exists "questions authenticated read" on public.sbuild_questions;
drop policy if exists "questions authenticated insert" on public.sbuild_questions;
drop policy if exists "questions owner update" on public.sbuild_questions;
create policy questions_project_read on public.sbuild_questions
  for select to authenticated using (sbuild_private.can_access_project(project_id));
create policy questions_project_draft on public.sbuild_questions
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and status = 'draft'
    and sbuild_private.can_access_project(project_id)
    and exists (
      select 1 from public.sbuild_project_contacts c
      where c.id = sbuild_questions.recipient_contact_id
        and c.project_id = sbuild_questions.project_id
        and c.role = sbuild_questions.recipient_role
    )
  );
create policy questions_owner_manage on public.sbuild_questions
  for update to authenticated
  using (sbuild_private.is_owner() and sbuild_private.can_access_project(project_id))
  with check (sbuild_private.is_owner() and sbuild_private.can_access_project(project_id));

drop policy if exists "messages authenticated read" on public.sbuild_question_messages;
drop policy if exists "messages authenticated insert" on public.sbuild_question_messages;
create policy messages_project_read on public.sbuild_question_messages
  for select to authenticated using (
    exists (
      select 1 from public.sbuild_questions q
      where q.id = sbuild_question_messages.question_id and sbuild_private.can_access_project(q.project_id)
    )
  );
create policy messages_project_draft_author on public.sbuild_question_messages
  for insert to authenticated with check (
    author_user_id = (select auth.uid())
    and author_contact_id is null
    and exists (
      select 1 from public.sbuild_questions q
      where q.id = sbuild_question_messages.question_id
        and q.created_by = (select auth.uid())
        and q.status = 'draft'
        and sbuild_private.can_access_project(q.project_id)
    )
    and (
      media_path is null
      or (
        (storage.foldername(media_path))[1] = (select auth.uid())::text
        and (storage.foldername(media_path))[2] = question_id::text
        and cardinality(storage.foldername(media_path)) = 2
      )
    )
  );

create index if not exists sbuild_question_messages_media_path_idx
  on public.sbuild_question_messages (media_path) where media_path is not null;

drop policy if exists "sbuild media read" on storage.objects;
drop policy if exists "sbuild media upload" on storage.objects;
create policy sbuild_question_media_read on storage.objects
  for select to authenticated using (
    bucket_id = 'sbuild-question-media'
    and (
      -- The author can check an already uploaded object while retrying a draft.
      (
        (storage.foldername(objects.name))[1] = (select auth.uid())::text
        and exists (
          select 1 from public.sbuild_questions q
          where q.id::text = (storage.foldername(objects.name))[2]
            and q.created_by = (select auth.uid())
            and q.status = 'draft'
            and sbuild_private.can_access_project(q.project_id)
        )
      )
      or exists (
        select 1
        from public.sbuild_question_messages m
        join public.sbuild_questions q on q.id = m.question_id
        where m.media_path = storage.objects.name
          and sbuild_private.can_access_project(q.project_id)
      )
    )
  );
create policy sbuild_question_media_upload on storage.objects
  for insert to authenticated with check (
    bucket_id = 'sbuild-question-media'
    and (storage.foldername(objects.name))[1] = (select auth.uid())::text
    and cardinality(storage.foldername(objects.name)) = 2
    and exists (
      select 1 from public.sbuild_questions q
      where q.id::text = (storage.foldername(objects.name))[2]
        and q.created_by = (select auth.uid())
        and q.status = 'draft'
        and sbuild_private.can_access_project(q.project_id)
    )
  );

commit;
