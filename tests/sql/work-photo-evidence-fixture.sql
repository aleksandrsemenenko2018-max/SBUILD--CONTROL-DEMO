-- Extend the disposable photo-rule fixture with the supported Storage metadata shape.
begin;
do $$
begin
  if to_regnamespace('storage') is not null or to_regclass('public.sbuild_work_assignments') is null
     or to_regclass('public.sbuild_work_photos') is null then
    raise exception 'Use the disposable photo-requirements database fixture';
  end if;
end;
$$;
alter table public.sbuild_work_photos
  add column id uuid primary key default gen_random_uuid(),
  add column project_id uuid references public.sbuild_projects(id),
  add column zone_id uuid references public.sbuild_zones(id),
  add column uploaded_by uuid references public.sbuild_profiles(user_id),
  add column storage_path text unique,
  add column note text;
alter table public.sbuild_work_photos enable row level security;
grant select on public.sbuild_work_photos to authenticated;
create policy fixture_photo_row_read on public.sbuild_work_photos for select to authenticated using (true);

create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.objects (
  bucket_id text not null,
  name text not null,
  owner_id text,
  owner uuid,
  metadata jsonb,
  primary key (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;
create policy fixture_legacy_object_access on storage.objects for all to anon, authenticated
  using (true) with check (true);
commit;
