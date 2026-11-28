-- Add current attendance and payout table shapes to the disposable report fixture.
begin;
do $$
begin
  if to_regclass('public.sbuild_attendance_daily') is not null
    or to_regclass('public.sbuild_audit_log') is null then
    raise exception 'Use the disposable production-workflow fixture';
  end if;
end;
$$;

alter table public.sbuild_work_reports
  add column work_date date,
  add column quantity numeric,
  add column worker_rate numeric;
create table public.sbuild_attendance_daily (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.sbuild_projects(id),
  worker_id uuid not null references public.sbuild_profiles(user_id),
  work_date date not null,
  present boolean not null,
  notes text not null default '',
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  unique (project_id, worker_id, work_date)
);
create table public.sbuild_weekly_payouts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.sbuild_projects(id),
  worker_id uuid not null references public.sbuild_profiles(user_id),
  week_start date not null,
  amount numeric not null,
  status text not null,
  paid_on date,
  recorded_by uuid not null,
  updated_at timestamptz not null default now(),
  unique (project_id, worker_id, week_start)
);
create function sbuild_private.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sbuild_profiles
    where user_id = (select auth.uid()) and active and role = 'owner'
  )
$$;
alter table public.sbuild_attendance_daily enable row level security;
alter table public.sbuild_weekly_payouts enable row level security;
grant select, insert, update on public.sbuild_attendance_daily, public.sbuild_weekly_payouts to authenticated;
create policy daily_attendance_read on public.sbuild_attendance_daily for select to authenticated using (
  sbuild_private.can_manage_project(project_id)
  or (worker_id = (select auth.uid()) and sbuild_private.can_access_project(project_id))
);
create policy weekly_payout_read on public.sbuild_weekly_payouts for select to authenticated using (
  sbuild_private.is_owner()
);
commit;
