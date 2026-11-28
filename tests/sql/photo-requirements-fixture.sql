-- Representative tables and existing approval checks in the disposable PostgreSQL fixture.
begin;
do $$
begin
  if to_regclass('public.sbuild_work_photo_requirements') is not null
    or to_regclass('public.sbuild_work_assignments') is null then
    raise exception 'Use the disposable work assignment database fixture';
  end if;
end;
$$;
create table public.sbuild_work_photo_requirements (
  report_id uuid primary key references public.sbuild_work_reports(id),
  required_before boolean not null,
  required_after boolean not null,
  hidden_work boolean not null,
  requires_recheck boolean not null
);
create table public.sbuild_work_photos (
  report_id uuid not null references public.sbuild_work_reports(id),
  stage text not null
);
create table public.sbuild_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  entity_table text not null,
  entity_id uuid not null,
  action text not null,
  details jsonb not null
);
grant select, insert on public.sbuild_work_photo_requirements to authenticated;

create function sbuild_private.fixture_default_photo_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sbuild_work_photo_requirements values (new.id, true, true, false, false);
  return new;
end;
$$;
create trigger fixture_default_photo_rules after insert on public.sbuild_work_reports
  for each row execute function sbuild_private.fixture_default_photo_rules();

create function sbuild_private.fixture_enforce_photo_requirements()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rule public.sbuild_work_photo_requirements%rowtype;
begin
  if new.status = 'owner_approved' and old.status is distinct from new.status then
    select * into rule from public.sbuild_work_photo_requirements where report_id = new.id;
    if (rule.required_before and not exists (select 1 from public.sbuild_work_photos where report_id = new.id and stage = 'before'))
      or (rule.required_after and not exists (select 1 from public.sbuild_work_photos where report_id = new.id and stage = 'after'))
      or (rule.hidden_work and not exists (select 1 from public.sbuild_work_photos where report_id = new.id and stage = 'hidden_before_close'))
      or (rule.requires_recheck and not exists (select 1 from public.sbuild_work_photos where report_id = new.id and stage = 'hidden_recheck')) then
      raise check_violation using message = 'Required photos are missing';
    end if;
  end if;
  return new;
end;
$$;
create trigger fixture_enforce_photo_requirements before update of status on public.sbuild_work_reports
  for each row execute function sbuild_private.fixture_enforce_photo_requirements();
commit;
