begin;
do $$
begin
  if sbuild_private.last_completed_client_report_week('2027-01-03 22:10:00+00', 'Europe/Kyiv') <> date '2026-12-28'
    or sbuild_private.last_completed_client_report_week('2027-01-03 22:10:00+00', 'UTC') <> date '2026-12-21'
    or sbuild_private.last_completed_client_report_week('2026-06-28 21:10:00+00', 'Europe/Kyiv') <> date '2026-06-22'
    or sbuild_private.last_completed_client_report_week('2026-06-28 21:10:00+00', 'UTC') <> date '2026-06-15'
  then raise exception 'Wrong ISO week for the supplied time zone'; end if;
end;
$$;

set local role service_role;
do $$
begin
  if public.sbuild_capture_client_report_week('2025-12-29') <> 2 then
    raise exception 'Active projects were not captured';
  end if;
  if public.sbuild_capture_client_report_week('2025-12-29') <> 0 then
    raise exception 'A retry inserted duplicate snapshots';
  end if;

  begin
    perform public.sbuild_capture_client_report_week('2025-12-30');
    raise exception 'Tuesday accepted as an ISO week start';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.sbuild_capture_client_report_week(date_trunc('week', now())::date + 14);
    raise exception 'Future week accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.sbuild_capture_client_report_week(null, null, 'PST');
    raise exception 'Unsupported time zone accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform 1 from public.sbuild_client_report_snapshots;
    raise exception 'Service RPC role can read raw snapshots directly';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
update public.sbuild_work_reports set description = 'Updated after capture'
where id = '00000000-0000-4000-8000-000000000931';
set local role service_role;
do $$
begin
  if public.sbuild_capture_client_report_week('2025-12-29') <> 0 then
    raise exception 'Retry replaced an immutable snapshot';
  end if;
  if public.sbuild_capture_client_report_week('2025-12-29', '00000000-0000-4000-8000-000000000903') <> 1 then
    raise exception 'Explicit backfill of a closed project failed';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000911', true);
do $$
declare
  captured jsonb;
begin
  if (select count(*) from public.sbuild_client_report_snapshots) <> 3 then
    raise exception 'Active owner cannot read snapshots';
  end if;
  select report into strict captured from public.sbuild_client_report_snapshots
  where project_id = '00000000-0000-4000-8000-000000000901';
  if captured <> '{
    "project":"Main project",
    "period":{"start":"2025-12-29","end":"2026-01-04"},
    "groups":[
      ["Floor 1 / Room A", [{"date":"2025-12-29","description":"Approved work","quantity":"1.235","unit":"m²","subtotal":124}]],
      ["Без зони", [{"date":"2026-01-04","description":"Approved without price","quantity":"2","unit":"m²","subtotal":null}]]
    ],
    "knownTotal":124,
    "unpricedCount":1
  }'::jsonb then raise exception 'Projection, period, immutable values or totals differ'; end if;
  if not exists (
    select 1 from public.sbuild_client_report_snapshots
    where project_id = '00000000-0000-4000-8000-000000000903'
      and report->'groups' = '[]'::jsonb and report->>'knownTotal' = '0'
  ) then raise exception 'A project with no approved work must have an empty snapshot'; end if;
  begin
    perform public.sbuild_capture_client_report_week('2025-12-29');
    raise exception 'Owner can call the service-only generator';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.sbuild_client_report_snapshots set report = '{}'::jsonb;
    raise exception 'Owner can update an existing snapshot';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000912', true);
do $$ begin
  if exists (select 1 from public.sbuild_client_report_snapshots) then
    raise exception 'Worker can read owner snapshots';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000913', true);
do $$ begin
  if exists (select 1 from public.sbuild_client_report_snapshots) then
    raise exception 'Inactive owner can read snapshots';
  end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform 1 from public.sbuild_client_report_snapshots;
    raise exception 'Anonymous role can read snapshots';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
