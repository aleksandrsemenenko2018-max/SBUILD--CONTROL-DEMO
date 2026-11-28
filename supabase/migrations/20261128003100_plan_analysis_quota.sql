-- The function deployment still defaults to disabled; this migration grants no AI activation.
begin;
create table sbuild_private.plan_analysis_calls (
    actor_id uuid not null,
    project_id uuid not null,
    created_at timestamptz not null default now()
);
create index sbuild_plan_analysis_time_idx on sbuild_private.plan_analysis_calls(created_at);
alter table sbuild_private.plan_analysis_calls enable row level security;
revoke all on sbuild_private.plan_analysis_calls from public, anon, authenticated;

create function public.sbuild_claim_plan_analysis(p_project_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    checked_at timestamptz;
begin
    if actor is null or p_project_id is null
        or not coalesce(sbuild_private.can_manage_project(p_project_id), false) then
        raise exception using errcode = '42501', message = 'No permission for this project';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sbuild:plan-analysis-quota', 0));
    checked_at := clock_timestamp();
    delete from sbuild_private.plan_analysis_calls
        where created_at < checked_at - interval '2 days';
    if (select count(*) from sbuild_private.plan_analysis_calls
        where created_at >= checked_at - interval '1 day') >= 30 or
       (select count(*) from sbuild_private.plan_analysis_calls
        where actor_id = actor and created_at >= checked_at - interval '1 day') >= 3 then
        return false;
    end if;
    insert into sbuild_private.plan_analysis_calls(actor_id, project_id)
        values (actor, p_project_id);
    return true;
end;
$$;
revoke all on function public.sbuild_claim_plan_analysis(uuid) from public, anon, authenticated;
grant execute on function public.sbuild_claim_plan_analysis(uuid) to authenticated;
commit;
