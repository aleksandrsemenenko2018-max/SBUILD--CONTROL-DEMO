begin;
insert into public.sbuild_projects values
 ('00000000-0000-4000-8000-000000000801'),
 ('00000000-0000-4000-8000-000000000802');
insert into public.sbuild_profiles values
 ('00000000-0000-4000-8000-000000000811', 'Active owner', 'owner', true),
 ('00000000-0000-4000-8000-000000000812', 'Foreman', 'foreman', true),
 ('00000000-0000-4000-8000-000000000813', 'Inactive owner', 'owner', false);
insert into public.sbuild_project_members values
 ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000812');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000811', true);
do $$
declare
  project constant uuid := '00000000-0000-4000-8000-000000000801';
  other_project constant uuid := '00000000-0000-4000-8000-000000000802';
  charge constant uuid := '00000000-0000-4000-8000-000000000821';
  advance constant uuid := '00000000-0000-4000-8000-000000000822';
  refund constant uuid := '00000000-0000-4000-8000-000000000823';
  transport constant uuid := '00000000-0000-4000-8000-000000000824';
  payment constant uuid := '00000000-0000-4000-8000-000000000825';
  reversal constant uuid := '00000000-0000-4000-8000-000000000826';
  other constant uuid := '00000000-0000-4000-8000-000000000827';
  today constant date := '2026-11-28';
  aggregate record;
begin
  perform public.sbuild_record_project_finance_entry(charge, project, 'customer_charge', 79999, today, 'Agreed invoice', null);
  if public.sbuild_record_project_finance_entry(charge, project, 'customer_charge', 79999, today, 'Agreed invoice', null) <> charge then
    raise exception 'A retry did not return the original operation';
  end if;
  perform public.sbuild_record_project_finance_entry(advance, project, 'customer_advance', 20000, today, 'Actual deposit', null);
  perform public.sbuild_record_project_finance_entry(refund, project, 'customer_refund', 1500, today, 'Refund', null);
  perform public.sbuild_record_project_finance_entry(transport, project, 'transport_expense', 2222, today, 'Fuel', null);
  perform public.sbuild_record_project_finance_entry(payment, project, 'customer_payment', 9876, today, 'Payment', null);

  select * into strict aggregate from public.sbuild_project_finance_balances where project_id = project;
  if row(aggregate.charged_cents, aggregate.paid_cents, aggregate.advance_cents,
         aggregate.refunded_cents, aggregate.transport_cents)
     is distinct from row('79999'::text, '9876'::text, '20000'::text, '1500'::text, '2222'::text) then
    raise exception 'Ledger category sums are incorrect';
  end if;

  perform public.sbuild_record_project_finance_entry(reversal, project, 'reversal', null, today, 'Duplicate payment record', payment);
  perform public.sbuild_record_project_finance_entry(reversal, project, 'reversal', null, today, 'Duplicate payment record', payment);
  if not exists(select 1 from public.sbuild_project_finance_history where id = payment and reversed)
    or (select paid_cents from public.sbuild_project_finance_balances where project_id = project) <> '0'
    or (select count(*) from public.sbuild_project_finance_history where id = reversal and amount_cents = 9876) <> 1 then
    raise exception 'Reversal did not preserve evidence or correctly remove the amount';
  end if;

  begin
    perform public.sbuild_record_project_finance_entry(charge, project, 'customer_charge', 80000, today, 'Changed', null);
    raise exception 'Idempotency key accepted changed inputs';
  exception when unique_violation then null;
  end;
  begin
    perform public.sbuild_record_project_finance_entry(other, other_project, 'reversal', null, today, 'Wrong project', charge);
    raise exception 'Cross-project reversal was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.sbuild_record_project_finance_entry(other, project, 'reversal', 999, today, 'Wrong amount', charge);
    raise exception 'A reversal could override the original amount';
  exception when check_violation then null;
  end;
  begin
    perform public.sbuild_record_project_finance_entry(other, project, 'reversal', null, today, 'Already reversed', payment);
    raise exception 'Duplicate reversal was accepted';
  exception when unique_violation then null;
  end;
  begin
    perform public.sbuild_record_project_finance_entry(other, project, 'reversal', null, today, 'Reverse reversal', reversal);
    raise exception 'A reversal could itself be reversed';
  exception when check_violation then null;
  end;
  begin
    perform public.sbuild_record_project_finance_entry(other, project, 'customer_charge', -1, today, 'Negative', null);
    raise exception 'Negative amount accepted';
  exception when check_violation then null;
  end;
  begin
    update public.sbuild_project_finance_ledger set amount_cents = 1 where id = charge;
    raise exception 'Owner may directly alter the ledger';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.sbuild_project_finance_ledger where id = charge;
    raise exception 'Owner may directly delete ledger evidence';
  exception when insufficient_privilege then null;
  end;
end;
$$;

do $$
declare
  profile_id uuid;
begin
  foreach profile_id in array array[
    '00000000-0000-4000-8000-000000000812'::uuid,
    '00000000-0000-4000-8000-000000000813'::uuid
  ] loop
    perform set_config('request.jwt.claim.sub', profile_id::text, true);
    if exists(select 1 from public.sbuild_project_finance_history)
      or exists(select 1 from public.sbuild_project_finance_balances)
      or exists(select 1 from public.sbuild_project_finance_ledger) then
      raise exception 'Financial records leaked to non-owner or inactive owner';
    end if;
    begin
      perform public.sbuild_record_project_finance_entry(
        '00000000-0000-4000-8000-000000000828', '00000000-0000-4000-8000-000000000801',
        'customer_charge', 100, '2026-11-28', 'Forbidden', null);
      raise exception 'Non-owner or inactive owner could add financial records';
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform count(*) from public.sbuild_project_finance_balances;
    raise exception 'Anonymous access to balances was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
