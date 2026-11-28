\set ON_ERROR_STOP on
do $$ begin
    if current_database() <> 'sbuild_warehouse_test' or to_regnamespace('auth') is not null then
        raise exception 'Use a new disposable database named sbuild_warehouse_test';
    end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create schema sbuild_private;
create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function sbuild_private.is_owner() returns boolean language sql stable as $$
    select auth.uid() = '00000000-0000-4000-8000-000000000001'::uuid
$$;
create function sbuild_private.can_manage_project(p uuid) returns boolean language sql stable as $$
    select coalesce((select sbuild_private.is_owner()) or
        (auth.uid() = '00000000-0000-4000-8000-000000000002'::uuid and
         p = '00000000-0000-4000-8000-000000000010'::uuid), false)
$$;
create table public.sbuild_material_requests (
    id uuid primary key, project_id uuid not null, zone_id uuid, status text not null
);
create table public.sbuild_audit_log (
    actor_id uuid, entity_table text, entity_id uuid, action text, details jsonb
);
create table public.sbuild_inventory_movements (
    id uuid primary key default gen_random_uuid(), project_id uuid, zone_id uuid, request_id uuid,
    material_name text, unit text, quantity numeric, kind text, transfer_group uuid,
    purchase_price numeric, customer_price numeric, created_at timestamptz not null default now()
);
grant select on public.sbuild_inventory_movements to authenticated;
grant select, update on public.sbuild_material_requests to authenticated;
create function public.sbuild_record_inventory(
    uuid, text, text, text, numeric, uuid, uuid, numeric, numeric, text, uuid, text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
    result uuid;
begin
    if $2 in ('issue', 'writeoff', 'transfer') and $5 > coalesce((
        select sum(quantity) from public.sbuild_inventory_movements
        where project_id = $1 and material_name = $3 and unit = $4), 0) then
        raise exception using errcode = '22023', message = 'Insufficient stock';
    end if;
    insert into public.sbuild_inventory_movements(project_id,kind,material_name,unit,quantity,zone_id,request_id,purchase_price,customer_price)
        values ($1,$2,$3,$4,case when $2 = 'receipt' then $5 else -$5 end,$6,$7,$8,$9) returning id into result;
    if $2 = 'transfer' then
        insert into public.sbuild_inventory_movements(project_id,kind,material_name,unit,quantity)
            values ($11,'transfer_in',$3,$4,$5);
    end if;
    return result;
end $$;
insert into public.sbuild_material_requests(id, project_id, zone_id, status) values (
    '00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000040', 'requested'
);
