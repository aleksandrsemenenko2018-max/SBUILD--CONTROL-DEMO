-- Apply only after the matching application version has been staged.
begin;

create table sbuild_private.inventory_operations (
    actor_id uuid not null,
    operation_id uuid not null,
    payload jsonb not null,
    movement_id uuid not null references public.sbuild_inventory_movements(id),
    created_at timestamptz not null default now(),
    primary key (actor_id, operation_id)
);

alter table sbuild_private.inventory_operations enable row level security;
revoke all on sbuild_private.inventory_operations from public, anon, authenticated;

create function public.sbuild_record_inventory_once(
    p_operation_id uuid,
    p_project_id uuid,
    p_kind text,
    p_material_name text,
    p_unit text,
    p_quantity numeric,
    p_zone_id uuid default null,
    p_request_id uuid default null,
    p_purchase_price numeric default 0,
    p_customer_price numeric default 0,
    p_destination_project uuid default null,
    p_receipt_reference text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    actor uuid := auth.uid();
    material text := btrim(p_material_name);
    unit_name text := btrim(p_unit);
    attempt jsonb;
    existing sbuild_private.inventory_operations%rowtype;
    first_lock bigint;
    second_lock bigint;
    movement uuid;
begin
    if actor is null or not sbuild_private.can_manage_project(p_project_id) then
        raise exception using errcode = '42501', message = 'No permission for this project';
    end if;
    if p_kind = 'transfer' and (p_destination_project is null or p_destination_project = p_project_id
            or not sbuild_private.can_manage_project(p_destination_project)) then
        raise exception using errcode = '42501', message = 'Destination project permission required';
    end if;
    if p_operation_id is null or p_kind is null or p_kind not in ('receipt', 'issue', 'writeoff', 'transfer')
        or material is null or length(material) not between 1 and 200
        or unit_name is null or length(unit_name) not between 1 and 30
        or p_quantity is null or p_quantity <= 0 or p_quantity > 1000000000
        or p_purchase_price is null or p_purchase_price < 0 or p_purchase_price > 1000000000
        or p_customer_price is null or p_customer_price < 0 or p_customer_price > 1000000000
        or coalesce(length(p_receipt_reference), 0) > 2048 then
        raise exception using errcode = '22023', message = 'Invalid inventory operation';
    end if;
    attempt := jsonb_build_array(p_project_id, p_kind, material, unit_name, p_quantity,
        p_zone_id, p_request_id, p_purchase_price, p_customer_price, p_destination_project, p_receipt_reference);

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'sbuild:inventory-operation:' || actor::text || ':' || p_operation_id::text, 0));
    select * into existing from sbuild_private.inventory_operations
        where actor_id = actor and operation_id = p_operation_id;
    if found then
        if existing.payload <> attempt then
            raise exception using errcode = '22023', message = 'Operation ID reused with different inventory data';
        end if;
        return existing.movement_id;
    end if;

    if p_request_id is not null and not exists (
        select 1 from public.sbuild_material_requests r
        where r.id = p_request_id and r.project_id = p_project_id
            and r.zone_id is not distinct from p_zone_id and r.status in ('approved', 'ordered', 'delivered')
    ) then
        raise exception using errcode = '22023', message = 'Inventory request must be approved and match project and zone';
    end if;

    -- Both directions use the same lock order for concurrent movements.
    first_lock := pg_catalog.hashtextextended(p_project_id::text || lower(material) || '|' || unit_name, 0);
    if p_kind = 'transfer' then
        second_lock := pg_catalog.hashtextextended(p_destination_project::text || lower(material) || '|' || unit_name, 0);
        perform pg_catalog.pg_advisory_xact_lock(least(first_lock, second_lock));
        perform pg_catalog.pg_advisory_xact_lock(greatest(first_lock, second_lock));
    else
        perform pg_catalog.pg_advisory_xact_lock(first_lock);
    end if;

    movement := public.sbuild_record_inventory(p_project_id, p_kind, material, unit_name,
        p_quantity, p_zone_id, p_request_id, p_purchase_price, p_customer_price,
        '', p_destination_project, p_receipt_reference);
    insert into sbuild_private.inventory_operations(actor_id, operation_id, payload, movement_id)
        values (actor, p_operation_id, attempt, movement);
    return movement;
end;
$$;

revoke all on function public.sbuild_record_inventory_once(uuid,uuid,text,text,text,numeric,uuid,uuid,numeric,numeric,uuid,text)
    from public, anon, authenticated;
grant execute on function public.sbuild_record_inventory_once(uuid,uuid,text,text,text,numeric,uuid,uuid,numeric,numeric,uuid,text)
    to authenticated;
revoke execute on function public.sbuild_record_inventory(uuid,text,text,text,numeric,uuid,uuid,numeric,numeric,text,uuid,text)
    from public, anon, authenticated;

-- Keep stock history and balance views available without exposing purchase or client prices.
revoke select on public.sbuild_inventory_movements from public, anon, authenticated;
revoke select (purchase_price, customer_price) on public.sbuild_inventory_movements from public, anon, authenticated;
grant select (id, project_id, zone_id, request_id, material_name, unit, quantity, kind, transfer_group, created_at)
    on public.sbuild_inventory_movements to authenticated;

create function sbuild_private.enforce_material_approval()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    if old.status is distinct from new.status then
        if ((old.status = 'requested' and new.status = 'approved') or new.status = 'rejected')
            and not sbuild_private.is_owner() then
            raise exception using errcode = '42501', message = 'Only an active owner can approve or reject a purchase request';
        end if;
        insert into public.sbuild_audit_log(actor_id, entity_table, entity_id, action, details)
        values (auth.uid(), 'sbuild_material_requests', new.id, 'status',
            jsonb_build_object('project', new.project_id, 'previous', old.status, 'current', new.status));
    end if;
    return new;
end;
$$;

revoke all on function sbuild_private.enforce_material_approval() from public, anon, authenticated;
create trigger sbuild_log_material_approval after update on public.sbuild_material_requests
    for each row execute function sbuild_private.enforce_material_approval();

commit;
