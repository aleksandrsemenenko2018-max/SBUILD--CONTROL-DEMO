\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$
declare
    operation uuid := '00000000-0000-4000-8000-000000000020';
    project_a uuid := '00000000-0000-4000-8000-000000000010';
    project_b uuid := '00000000-0000-4000-8000-000000000011';
    request_id uuid := '00000000-0000-4000-8000-000000000030';
    zone_id uuid := '00000000-0000-4000-8000-000000000040';
    original uuid;
begin
    begin
        update public.sbuild_material_requests set status = 'approved' where id = request_id;
        raise exception 'non-owner approved a request';
    exception when insufficient_privilege then null; end;
    begin
        perform public.sbuild_record_inventory_once(operation, project_a, 'receipt', 'Mortar', 'kg', 10, zone_id, request_id);
        raise exception 'receipt accepted an unapproved request';
    exception when invalid_parameter_value then null; end;
    original := public.sbuild_record_inventory_once(operation, project_a, 'receipt', ' Mortar ', 'kg', 10);
    if original <> public.sbuild_record_inventory_once(operation, project_a, 'receipt', 'Mortar', 'kg', 10) then
        raise exception 'same operation did not return original movement';
    end if;
    if (select sum(quantity) from public.sbuild_inventory_movements where project_id = project_a) <> 10 then
        raise exception 'receipt was duplicated';
    end if;
    begin
        perform public.sbuild_record_inventory_once(operation, project_a, 'receipt', 'Mortar', 'kg', 11);
        raise exception 'reused ID with changed payload';
    exception when invalid_parameter_value then null; end;
    begin
        perform public.sbuild_record_inventory_once(gen_random_uuid(), project_a, 'transfer', 'Mortar', 'kg', 1, p_destination_project => project_b);
        raise exception 'transfer succeeded without destination access';
    exception when insufficient_privilege then null; end;
    begin
        perform purchase_price from public.sbuild_inventory_movements;
        raise exception 'inventory allowed direct purchase-price access';
    exception when insufficient_privilege then null; end;
    begin
        perform public.sbuild_record_inventory(project_a, 'receipt', 'Mortar', 'kg', 2, null, null, 0, 0, '', null, null);
        raise exception 'legacy RPC remains callable';
    exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
update public.sbuild_material_requests set status = 'approved' where id = '00000000-0000-4000-8000-000000000030';
do $$
declare
    project_a uuid := '00000000-0000-4000-8000-000000000010';
    project_b uuid := '00000000-0000-4000-8000-000000000011';
begin
    perform public.sbuild_record_inventory_once(gen_random_uuid(), project_a, 'transfer', 'Mortar', 'kg', 4, p_destination_project => project_b);
    if (select sum(quantity) from public.sbuild_inventory_movements where project_id = project_a) <> 6 or
       (select sum(quantity) from public.sbuild_inventory_movements where project_id = project_b) <> 4 then
        raise exception 'unexpected transfer balance';
    end if;
    begin
        perform public.sbuild_record_inventory_once(gen_random_uuid(), project_a, 'issue', 'Mortar', 'kg', 7);
        raise exception 'insufficient stock was not rejected';
    exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ begin
    if not exists (select 1 from public.sbuild_audit_log where action = 'status' and details->>'current' = 'approved') then
        raise exception 'no approval audit event';
    end if;
end $$;
rollback;
