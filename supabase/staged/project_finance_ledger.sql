-- Optional owner ledger for actual customer charges and cash events.
begin;

create table public.sbuild_project_finance_ledger (
  id uuid primary key,
  project_id uuid not null references public.sbuild_projects(id),
  kind text not null check (kind in ('customer_charge', 'customer_payment', 'customer_advance',
    'customer_refund', 'transport_expense', 'reversal')),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000000),
  occurred_on date not null check (isfinite(occurred_on)),
  description text not null check (char_length(btrim(description)) between 1 and 240),
  reverses_entry_id uuid unique references public.sbuild_project_finance_ledger(id),
  recorded_by uuid not null references public.sbuild_profiles(user_id),
  recorded_at timestamptz not null default now(),
  check ((kind = 'reversal') = (reverses_entry_id is not null))
);

create index project_finance_ledger_history_idx on public.sbuild_project_finance_ledger
  (project_id, occurred_on desc, recorded_at desc, id desc);
create index project_finance_ledger_recorder_idx on public.sbuild_project_finance_ledger (recorded_by);

alter table public.sbuild_project_finance_ledger enable row level security;
revoke all on public.sbuild_project_finance_ledger from public, anon, authenticated;
grant select on public.sbuild_project_finance_ledger to authenticated;

create function sbuild_private.is_finance_owner()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sbuild_profiles p
    where p.user_id = (select auth.uid()) and p.active and p.role = 'owner'
  );
$$;
revoke execute on function sbuild_private.is_finance_owner() from public, anon;
grant execute on function sbuild_private.is_finance_owner() to authenticated;

create policy project_finance_ledger_owner_read on public.sbuild_project_finance_ledger
  for select to authenticated using ((select sbuild_private.is_finance_owner()));

create function sbuild_private.record_project_finance_entry(
  p_id uuid, p_project_id uuid, p_kind text, p_amount_cents bigint,
  p_occurred_on date, p_description text, p_reverses_entry_id uuid
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  amount bigint := p_amount_cents;
  details text := btrim(p_description);
  entry public.sbuild_project_finance_ledger%rowtype;
begin
  if actor is null or not sbuild_private.is_finance_owner()
    or sbuild_private.can_access_project(p_project_id) is distinct from true then
    raise insufficient_privilege using message = 'Only an active owner may record project finance entries';
  end if;

  if p_kind = 'reversal' then
    if p_amount_cents is not null or p_reverses_entry_id is null then
      raise check_violation using message = 'A reversal takes its amount from the original entry';
    end if;
    select ledger.amount_cents into amount
    from public.sbuild_project_finance_ledger ledger
    where ledger.id = p_reverses_entry_id and ledger.project_id = p_project_id and ledger.kind <> 'reversal';
    if not found then
      raise check_violation using message = 'Reverse an original entry in the selected project';
    end if;
  end if;

  -- The operation ID survives a retry with identical inputs. A separate unique
  -- constraint permits only one reversal of an original entry.
  insert into public.sbuild_project_finance_ledger
    (id, project_id, kind, amount_cents, occurred_on, description, reverses_entry_id, recorded_by)
  values (p_id, p_project_id, p_kind, amount, p_occurred_on, details, p_reverses_entry_id, actor)
  on conflict (id) do nothing;
  select * into strict entry from public.sbuild_project_finance_ledger where id = p_id;
  if row(entry.project_id, entry.kind, entry.amount_cents, entry.occurred_on, entry.description,
         entry.reverses_entry_id, entry.recorded_by)
     is distinct from
     row(p_project_id, p_kind, amount, p_occurred_on, details, p_reverses_entry_id, actor) then
    raise unique_violation using message = 'This operation ID is already used for a different entry';
  end if;
  return entry.id;
end;
$$;
revoke execute on function sbuild_private.record_project_finance_entry(uuid, uuid, text, bigint, date, text, uuid)
  from public, anon;
grant execute on function sbuild_private.record_project_finance_entry(uuid, uuid, text, bigint, date, text, uuid)
  to authenticated;

create function public.sbuild_record_project_finance_entry(
  p_id uuid, p_project_id uuid, p_kind text, p_amount_cents bigint,
  p_occurred_on date, p_description text, p_reverses_entry_id uuid
)
returns uuid
language sql security invoker set search_path = '' as $$
  select sbuild_private.record_project_finance_entry(
    p_id, p_project_id, p_kind, p_amount_cents, p_occurred_on, p_description, p_reverses_entry_id);
$$;
revoke execute on function public.sbuild_record_project_finance_entry(uuid, uuid, text, bigint, date, text, uuid)
  from public, anon;
grant execute on function public.sbuild_record_project_finance_entry(uuid, uuid, text, bigint, date, text, uuid)
  to authenticated;

create view public.sbuild_project_finance_history with (security_invoker = true) as
select ledger.id, ledger.project_id, ledger.kind, ledger.amount_cents, ledger.occurred_on,
       ledger.description, ledger.reverses_entry_id, ledger.recorded_at,
       exists (select 1 from public.sbuild_project_finance_ledger reversal
               where reversal.reverses_entry_id = ledger.id) as reversed
from public.sbuild_project_finance_ledger ledger;

create view public.sbuild_project_finance_balances with (security_invoker = true) as
select project_id,
       coalesce(sum(amount_cents) filter (where kind = 'customer_charge'), 0)::text as charged_cents,
       coalesce(sum(amount_cents) filter (where kind = 'customer_payment'), 0)::text as paid_cents,
       coalesce(sum(amount_cents) filter (where kind = 'customer_advance'), 0)::text as advance_cents,
       coalesce(sum(amount_cents) filter (where kind = 'customer_refund'), 0)::text as refunded_cents,
       coalesce(sum(amount_cents) filter (where kind = 'transport_expense'), 0)::text as transport_cents
from public.sbuild_project_finance_history
where kind <> 'reversal' and not reversed
group by project_id;

revoke all on public.sbuild_project_finance_history, public.sbuild_project_finance_balances from public, anon, authenticated;
grant select on public.sbuild_project_finance_history, public.sbuild_project_finance_balances to authenticated;

commit;
