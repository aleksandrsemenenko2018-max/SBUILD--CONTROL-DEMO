-- Apply after staged client_report_snapshots.sql, in an isolated database.
begin;

create table public.sbuild_client_report_charges (
  id uuid primary key,
  project_id uuid not null references public.sbuild_projects(id),
  charge_date date not null check (isfinite(charge_date)),
  kind text not null check (kind in ('material', 'other')),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000000),
  approved_by uuid not null default auth.uid() references public.sbuild_profiles(user_id),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.sbuild_profiles(user_id),
  check ((revoked_at is null) = (revoked_by is null))
);
create index client_report_charges_active_idx on public.sbuild_client_report_charges (project_id, charge_date, id)
  where revoked_at is null;
alter table public.sbuild_client_report_charges enable row level security;
revoke all on public.sbuild_client_report_charges from public, anon, authenticated, service_role;
grant select on public.sbuild_client_report_charges to authenticated;
grant insert (id, project_id, charge_date, kind, description, amount_cents)
  on public.sbuild_client_report_charges to authenticated;

create policy client_report_charges_read on public.sbuild_client_report_charges
  for select to authenticated using ((select sbuild_private.is_owner()));
create policy client_report_charges_create on public.sbuild_client_report_charges
  for insert to authenticated
  with check ((select sbuild_private.is_owner()) and approved_by = (select auth.uid()));

create function sbuild_private.revoke_client_report_charge(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if sbuild_private.is_owner() is distinct from true or auth.uid() is null then
    raise insufficient_privilege using message = 'Only an active owner may revoke a client charge';
  end if;

  update public.sbuild_client_report_charges set revoked_at = statement_timestamp(), revoked_by = auth.uid()
    where id = p_id and revoked_at is null;
end;
$$;
revoke execute on function sbuild_private.revoke_client_report_charge(uuid) from public, anon, service_role;
grant execute on function sbuild_private.revoke_client_report_charge(uuid) to authenticated;

create function public.sbuild_revoke_client_report_charge(p_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select sbuild_private.revoke_client_report_charge(p_id);
$$;
revoke execute on function public.sbuild_revoke_client_report_charge(uuid) from public, anon, service_role;
grant execute on function public.sbuild_revoke_client_report_charge(uuid) to authenticated;

create function sbuild_private.attach_client_report_charges()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  charges jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'date', to_char(c.charge_date, 'YYYY-MM-DD'), 'kind', c.kind,
    'description', c.description, 'subtotal', c.amount_cents
  ) order by c.charge_date, c.id)
  into charges from public.sbuild_client_report_charges c
  where c.project_id = new.project_id and c.revoked_at is null
    and c.charge_date between new.week_start and new.week_start + 6;

  if charges is not null then
    new.report := jsonb_set(new.report, '{charges}', charges);
  end if;
  return new;
end;
$$;
revoke execute on function sbuild_private.attach_client_report_charges() from public, anon, authenticated, service_role;
create trigger attach_client_report_charges before insert on public.sbuild_client_report_snapshots
  for each row execute function sbuild_private.attach_client_report_charges();

commit;
