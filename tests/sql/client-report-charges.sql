begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000911', true);
insert into public.sbuild_client_report_charges (id, project_id, charge_date, kind, description, amount_cents) values
 ('00000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000901', '2025-12-29', 'material', 'Agreed materials', 10023),
 ('00000000-0000-4000-8000-000000000942', '00000000-0000-4000-8000-000000000901', '2026-01-04', 'other', 'Agreed delivery', 3250),
 ('00000000-0000-4000-8000-000000000943', '00000000-0000-4000-8000-000000000901', '2026-01-04', 'other', 'Revoked text', 500),
 ('00000000-0000-4000-8000-000000000944', '00000000-0000-4000-8000-000000000901', '2026-01-05', 'other', 'Next week text', 500),
 ('00000000-0000-4000-8000-000000000945', '00000000-0000-4000-8000-000000000902', '2025-12-29', 'material', 'Other project text', 500)
on conflict (id) do nothing;
select public.sbuild_revoke_client_report_charge('00000000-0000-4000-8000-000000000943');
do $$
begin
  if exists (select 1 from public.sbuild_client_report_charges
             where approved_by <> '00000000-0000-4000-8000-000000000911'::uuid) then
    raise exception 'Approval actor was not recorded';
  end if;
  begin
    update public.sbuild_client_report_charges set description = 'Changed';
    raise exception 'Approved text is directly mutable';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local role service_role;
select public.sbuild_capture_client_report_week('2025-12-29', '00000000-0000-4000-8000-000000000901');
set local role authenticated;
do $$
declare
  payload jsonb;
begin
  select report into strict payload from public.sbuild_client_report_snapshots
  where project_id = '00000000-0000-4000-8000-000000000901';
  if (payload->'charges') is distinct from '[
    {"date":"2025-12-29","kind":"material","description":"Agreed materials","subtotal":10023},
    {"date":"2026-01-04","kind":"other","description":"Agreed delivery","subtotal":3250}
  ]'::jsonb then raise exception 'Report charge projection differs'; end if;
  perform public.sbuild_revoke_client_report_charge('00000000-0000-4000-8000-000000000941');
  if not exists(select 1 from public.sbuild_client_report_snapshots where report = payload) then
    raise exception 'Revocation overwrote the saved report';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000912', true);
do $$
begin
  if exists(select 1 from public.sbuild_client_report_charges) then
    raise exception 'Owner charges visible to a worker';
  end if;
  begin
    insert into public.sbuild_client_report_charges (id, project_id, charge_date, kind, description, amount_cents)
    values ('00000000-0000-4000-8000-000000000946', '00000000-0000-4000-8000-000000000901', '2025-12-29', 'material', 'Forged', 100);
    raise exception 'Worker can approve charges';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sbuild_revoke_client_report_charge('00000000-0000-4000-8000-000000000942');
    raise exception 'Worker can revoke charges';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
