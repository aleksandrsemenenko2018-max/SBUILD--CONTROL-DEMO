-- Limit report photos to the author and authorized project managers.
begin;

create function sbuild_private.can_access_work_photo(pid uuid, rid uuid, require_open boolean)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sbuild_work_reports report
    where report.id = rid and report.project_id = pid
      and (not require_open or report.status <> 'owner_approved')
      and sbuild_private.can_access_project(pid)
      and (report.worker_id = (select auth.uid()) or sbuild_private.can_manage_project(pid))
  )
$$;
revoke execute on function sbuild_private.can_access_work_photo(uuid, uuid, boolean) from public, anon;
grant execute on function sbuild_private.can_access_work_photo(uuid, uuid, boolean) to authenticated;

create function sbuild_private.can_access_work_photo_path(object_path text, require_open boolean)
returns boolean
language sql stable security invoker set search_path = '' as $$
  with path as (
    select regexp_match(object_path,
      '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[^/]+$'
    ) as parts
  )
  select sbuild_private.can_access_work_photo(parts[1]::uuid, parts[2]::uuid, require_open) from path
$$;
revoke execute on function sbuild_private.can_access_work_photo_path(text, boolean) from public, anon;
grant execute on function sbuild_private.can_access_work_photo_path(text, boolean) to authenticated;

-- Existing permissive bucket policies are constrained only for this bucket.
create policy report_photo_object_read on storage.objects as restrictive
  for select to authenticated using (
    bucket_id <> 'sbuild-work-photos' or sbuild_private.can_access_work_photo_path(name, false)
  );
create policy report_photo_object_insert on storage.objects as restrictive
  for insert to authenticated with check (
    bucket_id <> 'sbuild-work-photos' or (
      sbuild_private.can_access_work_photo_path(name, true)
      and split_part(name, '/', 3) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )
  );
create policy report_photo_object_no_update on storage.objects as restrictive
  for update to authenticated using (bucket_id <> 'sbuild-work-photos')
  with check (bucket_id <> 'sbuild-work-photos');
create policy report_photo_object_no_delete on storage.objects as restrictive
  for delete to authenticated using (bucket_id <> 'sbuild-work-photos');
create policy report_photo_object_no_anon on storage.objects as restrictive
  for all to anon using (bucket_id <> 'sbuild-work-photos')
  with check (bucket_id <> 'sbuild-work-photos');

create policy report_photo_manager_read on public.sbuild_work_photos
  for select to authenticated using (sbuild_private.can_manage_project(project_id));
create policy report_photo_authorized_read on public.sbuild_work_photos as restrictive
  for select to authenticated using (sbuild_private.can_access_work_photo(project_id, report_id, false));

revoke insert, update, delete on public.sbuild_work_photos from public, anon, authenticated;

create function sbuild_private.register_work_photo(rid uuid, object_path text, entry_stage text, entry_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  linked public.sbuild_work_reports%rowtype;
  file_size numeric;
  mime text;
  photo_id uuid;
  normalized_note text := btrim(coalesce(entry_note, ''));
begin
  select report.* into linked from public.sbuild_work_reports report
  where report.id = rid and sbuild_private.can_access_work_photo(report.project_id, report.id, false)
  for no key update;
  if not found or actor is null then
    raise insufficient_privilege using message = 'The work report is unavailable';
  end if;
  if object_path is null or object_path !~ (
    '^' || linked.project_id::text || '/' || linked.id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  ) then
    raise check_violation using message = 'The photo path does not match the project and report';
  end if;
  if entry_stage is null or entry_stage not in ('before', 'during', 'after', 'hidden_before_close', 'hidden_recheck')
      or char_length(normalized_note) > 1000 then
    raise check_violation using message = 'Invalid photo stage or note';
  end if;

  select photo.id into photo_id from public.sbuild_work_photos photo
  where photo.storage_path = object_path and photo.report_id = linked.id
    and photo.uploaded_by = actor and photo.stage = entry_stage and photo.note = normalized_note;
  if found then return photo_id; end if;
  if linked.status = 'owner_approved' then
    raise check_violation using message = 'Finalized work cannot receive new photos';
  end if;

  select object.metadata->>'mimetype',
    case when object.metadata->>'size' ~ '^[0-9]{1,8}$' then (object.metadata->>'size')::numeric end
  into mime, file_size from storage.objects object
  where object.bucket_id = 'sbuild-work-photos' and object.name = object_path
    and coalesce(object.owner_id, object.owner::text) = actor::text;
  if not found or file_size is null or file_size not between 1 and 15728640
      or mime is distinct from (case split_part(split_part(object_path, '/', 3), '.', 2)
        when 'jpg' then 'image/jpeg' when 'png' then 'image/png' when 'webp' then 'image/webp'
      end) then
    raise check_violation using message = 'An owned JPG, PNG or WebP object up to 15 MB is required';
  end if;

  insert into public.sbuild_work_photos (
    project_id, report_id, zone_id, uploaded_by, stage, storage_path, note
  ) values (
    linked.project_id, linked.id, linked.zone_id, actor, entry_stage, object_path, normalized_note
  ) returning id into photo_id;
  return photo_id;
end;
$$;
revoke execute on function sbuild_private.register_work_photo(uuid, text, text, text) from public, anon;
grant execute on function sbuild_private.register_work_photo(uuid, text, text, text) to authenticated;

create function public.sbuild_register_work_photo(
  p_report_id uuid, p_storage_path text, p_stage text, p_note text
)
returns uuid
language sql security invoker set search_path = '' as $$
  select sbuild_private.register_work_photo(p_report_id, p_storage_path, p_stage, p_note)
$$;
revoke execute on function public.sbuild_register_work_photo(uuid, text, text, text) from public, anon;
grant execute on function public.sbuild_register_work_photo(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
