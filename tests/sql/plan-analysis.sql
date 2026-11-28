\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$
declare
    project_a uuid := '00000000-0000-4000-8000-000000000010';
    project_b uuid := '00000000-0000-4000-8000-000000000011';
begin
    begin
        perform public.sbuild_claim_plan_analysis(project_b);
        raise exception 'cross-project analysis accepted';
    exception when insufficient_privilege then null; end;
    for attempt in 1..3 loop
        if not public.sbuild_claim_plan_analysis(project_a) then raise exception 'quota denied prematurely'; end if;
    end loop;
    if public.sbuild_claim_plan_analysis(project_a) then raise exception 'per-actor quota exceeded'; end if;
end $$;
rollback;
