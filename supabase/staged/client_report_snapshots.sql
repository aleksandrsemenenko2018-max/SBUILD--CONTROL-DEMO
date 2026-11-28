-- Apply only in a disposable S-BUILD database until reviewed.
begin;

create table public.sbuild_client_report_snapshots (
  project_id uuid not null references public.sbuild_projects(id),
  week_start date not null check (extract(isodow from week_start) = 1),
  generated_at timestamptz not null default statement_timestamp(),
  report jsonb not null check (
    jsonb_typeof(report) = 'object'
    and ((report ->> 'knownTotal')::numeric between 0 and 9007199254740991) is true
  ),
  primary key (project_id, week_start)
);

alter table public.sbuild_client_report_snapshots enable row level security;
revoke all on public.sbuild_client_report_snapshots from public, anon, authenticated, service_role;
grant select on public.sbuild_client_report_snapshots to authenticated;
create policy client_report_owner_read on public.sbuild_client_report_snapshots
  for select to authenticated using ((select sbuild_private.is_owner()));

create function sbuild_private.last_completed_client_report_week(p_instant timestamptz, p_time_zone text)
returns date language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_instant is null or not isfinite(p_instant) or p_time_zone is null
    or p_time_zone not in ('Europe/Kyiv', 'UTC') then
    raise invalid_parameter_value using message = 'A finite instant and Europe/Kyiv or UTC time zone are required';
  end if;
  return date_trunc('week', p_instant at time zone p_time_zone)::date - 7;
end;
$$;
revoke execute on function sbuild_private.last_completed_client_report_week(timestamptz, text)
  from public, anon, authenticated, service_role;

create function public.sbuild_capture_client_report_week(
  p_week_start date default null,
  p_project_id uuid default null,
  p_time_zone text default 'Europe/Kyiv'
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  last_completed date := sbuild_private.last_completed_client_report_week(statement_timestamp(), p_time_zone);
  week_start_date date := coalesce(p_week_start, last_completed);
  week_end_date date;
  inserted bigint;
begin
  if not isfinite(week_start_date) or extract(isodow from week_start_date) <> 1
    or week_start_date > last_completed then
    raise invalid_parameter_value using message = 'A completed ISO week starting on Monday is required';
  end if;
  week_end_date := week_start_date + 6;

  with recursive targets as materialized (
    select p.id, p.name from public.sbuild_projects p
    where (p_project_id is null and p.status = 'active' or p.id = p_project_id)
      and not exists (
        select 1 from public.sbuild_client_report_snapshots s
        where s.project_id = p.id and s.week_start = week_start_date
      )
  ), approved as materialized (
    select r.id, r.project_id, r.zone_id, r.work_date, r.description, r.quantity, r.unit,
      case when r.quantity >= 0 and r.client_rate >= 0
        and round(r.quantity * r.client_rate * 100) <= 9007199254740991
        then round(r.quantity * r.client_rate * 100)::bigint end as subtotal
    from public.sbuild_work_reports r
    join targets p on p.id = r.project_id
    where r.status = 'owner_approved' and r.work_date between week_start_date and week_end_date
  ), zones_used as (
    select distinct r.project_id, r.zone_id from approved r where r.zone_id is not null
  ), zone_paths(project_id, zone_id, parent_id, visited, names) as (
    select z.project_id, z.id, z.parent_id, array[z.id], array[z.name]
    from zones_used r join public.sbuild_zones z on z.id = r.zone_id and z.project_id = r.project_id
    union all
    select p.project_id, p.zone_id, z.parent_id, array_append(p.visited, z.id), array_prepend(z.name, p.names)
    from zone_paths p join public.sbuild_zones z on z.id = p.parent_id and z.project_id = p.project_id
    where not z.id = any(p.visited)
  ), best_zone_paths as (
    select distinct on (project_id, zone_id) project_id, zone_id, array_to_string(names, ' / ') as label
    from zone_paths order by project_id, zone_id, cardinality(visited) desc
  ), projected as (
    select r.*, coalesce(nullif(z.label, ''), 'Без зони') as zone_name,
      row_number() over (partition by r.project_id order by r.work_date, r.id) as line_order
    from approved r left join best_zone_paths z on z.project_id = r.project_id and z.zone_id = r.zone_id
  ), grouped as (
    select p.project_id, p.zone_name, min(p.line_order) as first_line,
      jsonb_agg(jsonb_build_object(
        'date', to_char(p.work_date, 'YYYY-MM-DD'),
        'description', p.description,
        'quantity', p.quantity::text,
        'unit', p.unit,
        'subtotal', p.subtotal
      ) order by p.line_order) as lines
    from projected p group by p.project_id, p.zone_name
  ), groups as (
    select project_id, jsonb_agg(jsonb_build_array(zone_name, lines) order by first_line) as items
    from grouped group by project_id
  ), totals as (
    select project_id, coalesce(sum(subtotal), 0) as known_total,
      count(*) filter (where subtotal is null) as unpriced
    from projected group by project_id
  )
  insert into public.sbuild_client_report_snapshots (project_id, week_start, report)
  select p.id, week_start_date, jsonb_build_object(
    'project', p.name,
    'period', jsonb_build_object('start', to_char(week_start_date, 'YYYY-MM-DD'), 'end', to_char(week_end_date, 'YYYY-MM-DD')),
    'groups', coalesce(groups.items, '[]'::jsonb),
    'knownTotal', coalesce(totals.known_total, 0),
    'unpricedCount', coalesce(totals.unpriced, 0)
  )
  from targets p
  left join groups on groups.project_id = p.id
  left join totals on totals.project_id = p.id
  order by p.id
  on conflict (project_id, week_start) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
revoke execute on function public.sbuild_capture_client_report_week(date, uuid, text) from public, anon, authenticated;
grant execute on function public.sbuild_capture_client_report_week(date, uuid, text) to service_role;

commit;
