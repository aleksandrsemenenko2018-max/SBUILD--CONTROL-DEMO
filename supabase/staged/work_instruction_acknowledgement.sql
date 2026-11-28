-- Require new assignments to carry a manager-authored instruction and record the worker's acknowledgement.
begin;

alter table public.sbuild_work_assignments add column instruction_text text;
alter table public.sbuild_work_assignments add constraint sbuild_work_assignments_instruction_length
  check (instruction_text is null or char_length(btrim(instruction_text)) between 1 and 4000);
grant insert (instruction_text) on public.sbuild_work_assignments to authenticated;

create table public.sbuild_work_assignment_acknowledgements (
  assignment_id uuid primary key references public.sbuild_work_assignments(id),
  actor_id uuid not null default auth.uid() references public.sbuild_profiles(user_id),
  acknowledged_at timestamptz not null default clock_timestamp()
);
create index sbuild_work_assignment_acknowledgements_actor_idx
  on public.sbuild_work_assignment_acknowledgements (actor_id);
alter table public.sbuild_work_assignment_acknowledgements enable row level security;
revoke all on public.sbuild_work_assignment_acknowledgements from public, anon, authenticated;
grant select on public.sbuild_work_assignment_acknowledgements to authenticated;
grant insert (assignment_id) on public.sbuild_work_assignment_acknowledgements to authenticated;
create policy assignment_ack_read on public.sbuild_work_assignment_acknowledgements
  for select to authenticated using (
    exists (select 1 from public.sbuild_work_assignments task where task.id = assignment_id)
  );
create policy assignment_ack_insert on public.sbuild_work_assignment_acknowledgements
  for insert to authenticated with check (
    actor_id = (select auth.uid()) and exists (
      select 1 from public.sbuild_work_assignments task
      where task.id = assignment_id and task.assigned_to = (select auth.uid())
        and task.status = 'assigned' and task.instruction_text is not null
    )
  );

create function sbuild_private.validate_assignment_acknowledgement()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  task public.sbuild_work_assignments%rowtype;
begin
  select * into task from public.sbuild_work_assignments where id = new.assignment_id for no key update;
  if not found or actor is null or new.actor_id is distinct from actor
      or task.assigned_to is distinct from actor or not sbuild_private.can_access_project(task.project_id) then
    raise insufficient_privilege using message = 'Only the assignee can acknowledge this instruction';
  end if;
  if task.status <> 'assigned' or task.instruction_text is null then
    raise check_violation using message = 'This assignment has no instruction awaiting acknowledgement';
  end if;
  return new;
end;
$$;
revoke execute on function sbuild_private.validate_assignment_acknowledgement() from public, anon, authenticated;
create trigger validate_assignment_acknowledgement
  before insert on public.sbuild_work_assignment_acknowledgements
  for each row execute function sbuild_private.validate_assignment_acknowledgement();

create function sbuild_private.enforce_assignment_instruction()
returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.instruction_text := btrim(new.instruction_text);
    if new.instruction_text is null or new.instruction_text = '' then
      raise check_violation using message = 'New assignments require a written work instruction';
    end if;
    return new;
  end if;
  if new.instruction_text is distinct from old.instruction_text then
    raise check_violation using message = 'An issued work instruction is immutable';
  end if;
  if old.status = 'assigned' and new.status = 'in_progress' and old.instruction_text is not null
      and not exists (
        select 1 from public.sbuild_work_assignment_acknowledgements ack
        where ack.assignment_id = old.id and ack.actor_id = old.assigned_to
      ) then
    raise check_violation using message = 'Acknowledge the work instruction before starting';
  end if;
  return new;
end;
$$;
revoke execute on function sbuild_private.enforce_assignment_instruction() from public, anon, authenticated;
create trigger enforce_assignment_instruction
  before insert or update on public.sbuild_work_assignments
  for each row execute function sbuild_private.enforce_assignment_instruction();

notify pgrst, 'reload schema';
commit;
