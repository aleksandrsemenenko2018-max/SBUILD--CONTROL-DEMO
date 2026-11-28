\set ON_ERROR_STOP on
begin;
set local role service_role;
insert into public.sbuild_telegram_send_claims(question_id, attempt_id, state) values (
  '00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000062', 'sending'
);
do $$
declare
  q uuid := '00000000-0000-4000-8000-000000000032';
  c uuid := '00000000-0000-4000-8000-000000000022';
  claim uuid := '00000000-0000-4000-8000-000000000062';
begin
  perform public.sbuild_finish_telegram_send(q, claim, c, 'synthetic-chat-id', 500);
  if not public.sbuild_save_telegram_reply(q, c, 'synthetic-chat-id', 501, 'Synthetic reply', null, null) then
    raise exception 'reply was not persisted';
  end if;
  if public.sbuild_save_telegram_reply(q, c, 'synthetic-chat-id', 501, 'Synthetic reply', null, null)
      or public.sbuild_save_telegram_reply(q, c, 'wrong-chat', 502, 'Synthetic reply', null, null) then
    raise exception 'duplicate or wrong-chat reply was accepted';
  end if;
  if (select count(*) from public.sbuild_question_messages where question_id=q and telegram_message_id=501) <> 1
      or (select status from public.sbuild_questions where id=q) <> 'answered' then
    raise exception 'unexpected persisted reply state';
  end if;
end $$;
set local role authenticated;
do $$ begin
  if has_function_privilege(current_user,
      'public.sbuild_save_telegram_reply(uuid,uuid,text,bigint,text,text,text)', 'EXECUTE') then
    raise exception 'browser role can invoke service-only Telegram RPC';
  end if;
end $$;
rollback;
