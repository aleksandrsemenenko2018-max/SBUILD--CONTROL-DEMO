-- Apply after work_assignments.sql and the communications migrations.
begin;

create function public.sbuild_owner_daily_summary(
  p_day date default (current_timestamp at time zone 'Europe/Kyiv')::date,
  p_project_id uuid default null
)
returns table (
  summary_day date,
  project_id uuid,
  project_name text,
  open_tasks bigint,
  tasks_due_today bigint,
  overdue_tasks bigint,
  reports_waiting_foreman bigint,
  reports_waiting_owner bigint,
  issue_drafts bigint,
  issues_waiting_reply bigint
)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null or not coalesce((select sbuild_private.is_owner()), false) then
    raise insufficient_privilege using message = 'Only an active owner can read the daily summary';
  end if;
  if p_day is null or not isfinite(p_day) then
    raise invalid_parameter_value using message = 'A finite date is required';
  end if;

  return query
  with project_scope as materialized (
    select project.id, project.name
    from public.sbuild_projects project
    where (p_project_id is null or project.id = p_project_id)
      and sbuild_private.can_access_project(project.id)
  ), tasks as (
    select task.project_id,
      count(*) as open,
      count(*) filter (where task.due_on = p_day) as due,
      count(*) filter (where task.due_on < p_day) as overdue
    from public.sbuild_work_assignments task
    join project_scope scope on scope.id = task.project_id
    where task.status in ('assigned', 'in_progress')
    group by task.project_id
  ), reports as (
    select report.project_id,
      count(*) filter (where report.status = 'submitted') as waiting_foreman,
      count(*) filter (where report.status = 'foreman_approved') as waiting_owner
    from public.sbuild_work_reports report
    join project_scope scope on scope.id = report.project_id
    where report.status in ('submitted', 'foreman_approved')
    group by report.project_id
  ), issues as (
    select issue.project_id,
      count(*) filter (where issue.status = 'draft') as drafts,
      count(*) filter (where issue.status = 'sent') as waiting_reply
    from public.sbuild_questions issue
    join project_scope scope on scope.id = issue.project_id
    where issue.status in ('draft', 'sent') and not exists (
      select 1 from public.sbuild_question_messages message
      where message.question_id = issue.id and message.author_contact_id is not null
    )
    group by issue.project_id
  )
  select p_day, scope.id, scope.name::text,
    coalesce(tasks.open, 0), coalesce(tasks.due, 0), coalesce(tasks.overdue, 0),
    coalesce(reports.waiting_foreman, 0), coalesce(reports.waiting_owner, 0),
    coalesce(issues.drafts, 0), coalesce(issues.waiting_reply, 0)
  from project_scope scope
  left join tasks on tasks.project_id = scope.id
  left join reports on reports.project_id = scope.id
  left join issues on issues.project_id = scope.id
  order by scope.name, scope.id;
end;
$$;
revoke execute on function public.sbuild_owner_daily_summary(date, uuid) from public, anon;
grant execute on function public.sbuild_owner_daily_summary(date, uuid) to authenticated;

commit;
