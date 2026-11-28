begin;
insert into public.sbuild_projects values ('00000000-0000-4000-8000-000000003001');
insert into public.sbuild_profiles values
 ('00000000-0000-4000-8000-000000003101', 'Foreman', 'foreman', true),
 ('00000000-0000-4000-8000-000000003102', 'Author', 'worker', true),
 ('00000000-0000-4000-8000-000000003103', 'Coworker', 'worker', true);
insert into public.sbuild_project_members
select '00000000-0000-4000-8000-000000003001', user_id from public.sbuild_profiles
where user_id in ('00000000-0000-4000-8000-000000003101','00000000-0000-4000-8000-000000003102','00000000-0000-4000-8000-000000003103');
insert into public.sbuild_work_reports values
 ('00000000-0000-4000-8000-000000003201', null, '00000000-0000-4000-8000-000000003001', '00000000-0000-4000-8000-000000003102', 'submitted');
insert into storage.objects values ('unrelated-bucket', 'keep-existing-behavior', null, null, null);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000003102', true);
do $$
declare
  report constant uuid := '00000000-0000-4000-8000-000000003201';
  root constant text := '00000000-0000-4000-8000-000000003001/00000000-0000-4000-8000-000000003201/';
  jpg constant text := root || '00000000-0000-4000-8000-000000003300.jpg';
  missing constant text := root || '00000000-0000-4000-8000-000000003301.jpg';
  wrong_mime constant text := root || '00000000-0000-4000-8000-000000003302.png';
  size_unknown constant text := root || '00000000-0000-4000-8000-000000003303.webp';
  id uuid;
begin
  begin
    insert into storage.objects values ('sbuild-work-photos', root || 'unsafe.svg', auth.uid()::text, null, '{}');
    raise exception 'Unsafe storage path was accepted';
  exception when insufficient_privilege then null;
  end;
  insert into storage.objects values
    ('sbuild-work-photos', jpg, auth.uid()::text, null, '{"mimetype":"image/jpeg","size":1000}'),
    ('sbuild-work-photos', wrong_mime, auth.uid()::text, null, '{"mimetype":"image/jpeg","size":200}'),
    ('sbuild-work-photos', size_unknown, auth.uid()::text, null, '{"mimetype":"image/webp","size":"bad"}');
  begin
    perform public.sbuild_register_work_photo(report, missing, 'before', '');
    raise exception 'Unuploaded evidence was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.sbuild_register_work_photo(report, wrong_mime, 'before', '');
    raise exception 'MIME did not match the extension';
  exception when check_violation then null;
  end;
  begin
    perform public.sbuild_register_work_photo(report, size_unknown, 'before', '');
    raise exception 'Missing or unreadable object size was accepted';
  exception when check_violation then null;
  end;
  id := public.sbuild_register_work_photo(report, jpg, 'before', ' evidence ');
  if id is null or public.sbuild_register_work_photo(report, jpg, 'before', 'evidence') is distinct from id
     or not exists (select 1 from public.sbuild_work_photos where storage_path = jpg and uploaded_by = auth.uid()) then
    raise exception 'Valid owner photo registration or retry failed';
  end if;
  delete from storage.objects where name = jpg;
  if not exists (select 1 from storage.objects where name = jpg) then
    raise exception 'Uploader could delete evidence';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000003101', true);
do $$
begin
  if not exists (select 1 from public.sbuild_work_photos)
     or not exists (select 1 from storage.objects where bucket_id = 'sbuild-work-photos') then
    raise exception 'Project foreman cannot review photo evidence';
  end if;
  begin
    perform public.sbuild_register_work_photo('00000000-0000-4000-8000-000000003201',
      '00000000-0000-4000-8000-000000003001/00000000-0000-4000-8000-000000003201/00000000-0000-4000-8000-000000003300.jpg',
      'after', '');
    raise exception 'Foreman registered evidence from another uploader';
  exception when check_violation then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000003103', true);
do $$
begin
  if exists (select 1 from public.sbuild_work_photos)
     or exists (select 1 from storage.objects where bucket_id = 'sbuild-work-photos') then
    raise exception 'Coworker read report photo evidence';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'unrelated-bucket') then
    raise exception 'Other storage policies changed';
  end if;
  begin
    insert into storage.objects values ('sbuild-work-photos',
     '00000000-0000-4000-8000-000000003001/00000000-0000-4000-8000-000000003201/00000000-0000-4000-8000-000000003303.jpg',
     auth.uid()::text, null, '{}');
    raise exception 'Coworker could upload to an unrelated report';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'sbuild-work-photos') then
    raise exception 'Anonymous user could retrieve storage metadata';
  end if;
end;
$$;
rollback;
