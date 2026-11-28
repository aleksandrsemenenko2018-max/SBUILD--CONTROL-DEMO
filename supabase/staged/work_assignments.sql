-- Apply after the existing S-BUILD projects, profiles, memberships, zones, and work reports.
begin;

create table public.sbuild_work_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.sbuild_projects(id),
  zone_id uuid not null references public.sbuild_zones(id),
  assigned_to uuid not null references public.sbuild_profiles(user_id),
  assigned_by uuid not null default auth.uid() references public.sbuild_profiles(user_id),
  title text not null check (char_length(btrim(title)) between 1 and 150),
  due_on date,
  status text not null default 'assigned'
    check (status in ('assigned', 'in_progress', 'submitted', 'cancelled')),
  report_id uuid unique references public.sbuild_work_reports(id),
  created_at timestamptz not null default now(),
  check ((status = 'submitted') = (report_id is not null))
);

create index sbuild_work_assignments_project_idx on public.sbuild_work_assignments (project_id, created_at desc);
create index sbuild_work_assignments_assignee_idx on public.sbuild_work_assignments (assigned_to, project_id);
create index sbuild_work_assignments_zone_idx on public.sbuild_work_assignments (zone_id);
create index sbuild_work_assignments_assigner_idx on public.sbuild_work_assignments (assigned_by);

create table public.sbuild_work_assignment_events (
  id bigint generated always as identity primary key,
  assignment_id uuid not null references public.sbuild_work_assignments(id),
  actor_id uuid not null references public.sbuild_profiles(user_id),
  old_status text,
  new_status text not null,
  report_id uuid,
  changed_at timestamptz not null default now()
);
create index sbuild_work_assignment_events_task_idx on public.sbuild_work_assignment_events (assignment_id, id);

alter table public.sbuild_work_assignments enable row level security;
alter table public.sbuild_work_assignment_events enable row level security;
revoke all on public.sbuild_work_assignments, public.sbuild_work_assignment_events from public, anon, authenticated;
grant select on public.sbuild_work_assignments, public.sbuild_work_assignment_events to authenticated;
grant insert (project_id, zone_id, assigned_to, title, due_on),
      update (status, report_id)
  on public.sbuild_work_assignments to authenticated;

create policy assignment_read on public.sbuild_work_assignments
  for select to authenticated using (
    sbuild_private.can_manage_project(project_id)
    or (assigned_to = (select auth.uid()) and sbuild_private.can_access_project(project_id))
  );
create policy assignment_create on public.sbuild_work_assignments
  for insert to authenticated with check (
    assigned_by = (select auth.uid()) and sbuild_private.can_manage_project(project_id)
  );
create policy assignment_update on public.sbuild_work_assignments
  for update to authenticated
  using (
    sbuild_private.can_manage_project(project_id)
    or (assigned_to = (select auth.uid()) and sbuild_private.can_access_project(project_id))
  )
  with check (
    sbuild_private.can_manage_project(project_id)
    or (assigned_to = (select auth.uid()) and sbuild_private.can_access_project(project_id))
  );
create policy assignment_event_read on public.sbuild_work_assignment_events
  for select to authenticated using (
    exists (select 1 from public.sbuild_work_assignments task where task.id = assignment_id)
  );

-- The project-membership check remains in the unexposed schema so this
-- endpoint reveals only active assignees and no private profile columns.
create function sbuild_private.work_assignment_roster(pid uuid)
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.full_name
  from public.sbuild_project_members m
  join public.sbuild_profiles p on p.user_id = m.user_id
  where m.project_id = pid and p.active
    and p.role in ('worker', 'brigadier', 'foreman', 'technical_director')
    and sbuild_private.can_manage_project(pid)
  order by p.full_name, p.user_id;
$$;
revoke execute on function sbuild_private.work_assignment_roster(uuid) from public, anon;
grant execute on function sbuild_private.work_assignment_roster(uuid) to authenticated;

create function public.sbuild_work_assignment_roster(p_project_id uuid)
returns table (user_id uuid, full_name text)
language sql stable security invoker set search_path = '' as $$
  select * from sbuild_private.work_assignment_roster(p_project_id);
$$;
revoke execute on function public.sbuild_work_assignment_roster(uuid) from public, anon;
grant execute on function public.sbuild_work_assignment_roster(uuid) to authenticated;

create function sbuild_private.enforce_work_assignment()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  linked_report public.sbuild_work_reports%rowtype;
begin
  if tg_op = 'INSERT' then
    if actor is null or new.assigned_by is distinct from actor
        or not sbuild_private.can_manage_project(new.project_id) then
      raise insufficient_privilege using message = 'Only a project manager can create an assignment';
    end if;
    if new.status <> 'assigned' or new.report_id is not null then
      raise check_violation using message = 'New assignments must start in the assigned state';
    end if;
    if not exists (
      select 1 from public.sbuild_zones z where z.id = new.zone_id and z.project_id = new.project_id
    ) then
      raise check_violation using message = 'The zone must belong to the assignment project';
    end if;
    if not exists (
      select 1 from sbuild_private.work_assignment_roster(new.project_id) p
      where p.user_id = new.assigned_to
    ) then
      raise check_violation using message = 'The assignee must be an active member of the project';
    end if;
    return new;
  end if;

  if row(new.id, new.project_id, new.zone_id, new.assigned_to, new.assigned_by, new.title, new.due_on, new.created_at)
     is distinct from
     row(old.id, old.project_id, old.zone_id, old.assigned_to, old.assigned_by, old.title, old.due_on, old.created_at) then
    raise check_violation using message = 'Assignment details are immutable';
  end if;
  if new.status = 'cancelled' then
    if not sbuild_private.can_manage_project(old.project_id) then
      raise insufficient_privilege using message = 'Only a project manager can cancel an assignment';
    end if;
    if old.status not in ('assigned', 'in_progress') or new.report_id is not null then
      raise check_violation using message = 'Only unfinished work without a report can be cancelled';
    end if;
    return new;
  end if;
  if actor is null or old.assigned_to is distinct from actor
      or not sbuild_private.can_access_project(old.project_id) then
    raise insufficient_privilege using message = 'Only the assigned project member can report progress';
  end if;
  if old.status = 'assigned' and new.status = 'in_progress' and new.report_id is null then
    return new;
  end if;
  if old.status = 'in_progress' and new.status = 'submitted' then
    select report.* into linked_report
    from public.sbuild_work_reports report
    where report.id = new.report_id for no key update;
    if not found or linked_report.status <> 'submitted'
        or linked_report.project_id is distinct from old.project_id
        or linked_report.zone_id is distinct from old.zone_id
        or linked_report.worker_id is distinct from actor then
      raise check_violation using message = 'Attach your submitted report for this project zone';
    end if;
    return new;
  end if;
  if old.status = 'submitted' and new.status = 'in_progress' and new.report_id is null then
    select report.* into linked_report
    from public.sbuild_work_reports report
    where report.id = old.report_id for no key update;
    if found and linked_report.status = 'returned' then
      return new;
    end if;
  end if;
  raise check_violation using message = 'Invalid assignment status transition';
end;
$$;
revoke execute on function sbuild_private.enforce_work_assignment() from public, anon, authenticated;

create function sbuild_private.record_work_assignment_event()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sbuild_work_assignment_events (assignment_id, actor_id, old_status, new_status, report_id)
  values (new.id, (select auth.uid()), case when tg_op = 'UPDATE' then old.status end,
          new.status, coalesce(new.report_id, case when tg_op = 'UPDATE' then old.report_id end));
  return new;
end;
$$;
revoke execute on function sbuild_private.record_work_assignment_event() from public, anon, authenticated;

-- Keep the original report in the same work zone after it is linked.
create function sbuild_private.preserve_assignment_report_zone()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.zone_id is distinct from old.zone_id and exists (
    select 1 from public.sbuild_work_assignments task where task.report_id = old.id
  ) then
    raise check_violation using message = 'An assigned report must remain in its original zone';
  end if;
  return new;
end;
$$;
revoke execute on function sbuild_private.preserve_assignment_report_zone() from public, anon, authenticated;
create trigger preserve_assignment_report_zone before update of zone_id on public.sbuild_work_reports
  for each row execute function sbuild_private.preserve_assignment_report_zone();

create trigger enforce_work_assignment
  before insert or update on public.sbuild_work_assignments
  for each row execute function sbuild_private.enforce_work_assignment();
create trigger record_work_assignment_event
  after insert or update on public.sbuild_work_assignments
  for each row execute function sbuild_private.record_work_assignment_event();

notify pgrst, 'reload schema';
commit;
