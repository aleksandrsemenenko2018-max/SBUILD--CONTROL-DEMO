-- Add the existing quality table shape to the disposable fixture.
begin;
do $$
begin
  if to_regclass('public.sbuild_quality_checklists') is not null
    or to_regclass('public.sbuild_work_assignments') is null then
    raise exception 'Use the disposable work assignment database fixture';
  end if;
end;
$$;
create table public.sbuild_quality_checklists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.sbuild_projects(id),
  zone_id uuid references public.sbuild_zones(id),
  report_id uuid references public.sbuild_work_reports(id),
  items jsonb not null,
  status text not null default 'draft',
  created_by uuid not null references public.sbuild_profiles(user_id)
);
alter table public.sbuild_quality_checklists enable row level security;
grant select, insert, update, delete on public.sbuild_quality_checklists to authenticated;
create policy quality_read on public.sbuild_quality_checklists for select to authenticated
  using (sbuild_private.can_access_project(project_id));
create policy quality_create on public.sbuild_quality_checklists for insert to authenticated
  with check (sbuild_private.can_access_project(project_id) and created_by = (select auth.uid()) and status in ('draft', 'submitted'));
create policy quality_update on public.sbuild_quality_checklists for update to authenticated
  using (sbuild_private.can_manage_project(project_id) or (created_by = (select auth.uid()) and status in ('draft', 'returned')))
  with check (sbuild_private.can_manage_project(project_id) or (created_by = (select auth.uid()) and status in ('draft', 'submitted')));
create policy quality_delete on public.sbuild_quality_checklists for delete to authenticated
  using (sbuild_private.can_manage_project(project_id));
commit;
