-- Keep provider sends and answer retries safe without touching existing delivery records.
begin;

create table public.sbuild_telegram_send_claims (
  question_id uuid primary key references public.sbuild_questions(id) on delete cascade,
  attempt_id uuid not null,
  state text not null check (state in ('sending', 'sent', 'uncertain')),
  telegram_message_id bigint,
  created_at timestamptz not null default now(),
  check ((state = 'sent') = (telegram_message_id is not null))
);

create table public.sbuild_telegram_reply_claims (
  chat_id text not null,
  telegram_message_id bigint not null,
  question_id uuid not null references public.sbuild_questions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chat_id, telegram_message_id)
);

alter table public.sbuild_telegram_send_claims enable row level security;
alter table public.sbuild_telegram_reply_claims enable row level security;
revoke all on public.sbuild_telegram_send_claims, public.sbuild_telegram_reply_claims from public, anon, authenticated;
grant select, insert, update, delete on public.sbuild_telegram_send_claims to service_role;
grant select, insert on public.sbuild_telegram_reply_claims to service_role;

create function public.sbuild_finish_telegram_send(
  p_question_id uuid,
  p_attempt_id uuid,
  p_contact_id uuid,
  p_chat_id text,
  p_message_id bigint
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.sbuild_telegram_send_claims
  set state = 'sent', telegram_message_id = p_message_id
  where question_id = p_question_id and attempt_id = p_attempt_id and state = 'sending';
  if not found then
    raise exception 'Telegram send claim was not held';
  end if;

  insert into public.sbuild_telegram_deliveries (question_id, contact_id, chat_id, telegram_message_id)
  values (p_question_id, p_contact_id, p_chat_id, p_message_id);

  update public.sbuild_questions set status = 'sent'
  where id = p_question_id and status = 'draft';
end;
$$;

create function public.sbuild_save_telegram_reply(
  p_question_id uuid,
  p_contact_id uuid,
  p_chat_id text,
  p_message_id bigint,
  p_body text,
  p_media_path text,
  p_media_type text
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_body is null and p_media_path is null then
    return false;
  end if;
  perform 1 from public.sbuild_questions q
  join public.sbuild_project_contacts c on c.id = q.recipient_contact_id and c.project_id = q.project_id
  where q.id = p_question_id and c.id = p_contact_id and c.telegram_chat_id = p_chat_id
  for update of q, c;
  if not found then
    return false;
  end if;

  if exists (
    select 1 from public.sbuild_question_messages
    where question_id = p_question_id and author_contact_id = p_contact_id
      and telegram_message_id = p_message_id
  ) then
    return false;
  end if;

  insert into public.sbuild_telegram_reply_claims (chat_id, telegram_message_id, question_id)
  values (p_chat_id, p_message_id, p_question_id)
  on conflict (chat_id, telegram_message_id) do nothing;
  if not found then
    return false;
  end if;

  insert into public.sbuild_question_messages (
    question_id, author_contact_id, telegram_message_id, body, media_path, media_type
  ) values (p_question_id, p_contact_id, p_message_id, p_body, p_media_path, p_media_type);

  update public.sbuild_questions set status = 'answered' where id = p_question_id;
  return true;
end;
$$;

revoke execute on function public.sbuild_finish_telegram_send(uuid, uuid, uuid, text, bigint) from public, anon, authenticated;
revoke execute on function public.sbuild_save_telegram_reply(uuid, uuid, text, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.sbuild_finish_telegram_send(uuid, uuid, uuid, text, bigint) to service_role;
grant execute on function public.sbuild_save_telegram_reply(uuid, uuid, text, bigint, text, text, text) to service_role;

commit;
