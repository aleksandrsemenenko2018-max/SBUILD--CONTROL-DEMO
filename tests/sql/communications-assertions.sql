-- Run after communications-setup.sql and the migration in the test database.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);

do $$
begin
  assert (select count(*) from public.sbuild_project_contacts) = 1, 'member sees only own project contacts';
  assert (select count(*) from public.sbuild_list_project_contacts()) = 1, 'recipient directory remains available to project members';
  assert (select link_code is null and not telegram_connected from public.sbuild_list_project_contacts()), 'member does not get a linking code';
  begin
    perform link_code from public.sbuild_project_contacts;
    raise exception 'direct linking credential read accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform telegram_chat_id from public.sbuild_project_contacts;
    raise exception 'direct chat ID read accepted';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.sbuild_questions) = 1, 'member sees only own project questions';
  assert (select count(*) from public.sbuild_question_messages) = 1, 'member sees only own project messages';
  assert (select count(*) from storage.objects) = 2, 'draft author can resume an upload without exposing foreign objects';

  insert into storage.objects values
    ('sbuild-question-media','00000000-0000-4000-8000-000000000011/00000000-0000-4000-8000-000000000031/new.pdf');
  insert into public.sbuild_question_messages values
    ('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000011',null,'00000000-0000-4000-8000-000000000011/00000000-0000-4000-8000-000000000031/new.pdf');
  assert (select count(*) from public.sbuild_question_messages) = 2, 'draft author can attach own upload';

  insert into public.sbuild_questions values
    ('00000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','designer','draft')
    on conflict (id) do nothing;
  assert (select count(*) from public.sbuild_questions) = 2, 'member can create a draft for own project';

  begin
    insert into public.sbuild_questions values
      ('00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000022','customer','draft');
    raise exception 'cross-project contact accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.sbuild_questions values
      ('00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000022','customer','draft');
    raise exception 'cross-project draft accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects values
      ('sbuild-question-media','00000000-0000-4000-8000-000000000011/00000000-0000-4000-8000-000000000032/rejected.pdf');
    raise exception 'cross-project object accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.sbuild_question_messages values
      ('00000000-0000-4000-8000-000000000044','00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000011',null,null);
    raise exception 'cross-project message accepted';
  exception when insufficient_privilege then null;
  end;
end
$$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',true);
do $$
begin
  assert (select count(*) from storage.objects) = 2, 'project peer can see linked objects but not retry-only uploads';
  begin
    insert into storage.objects values
      ('sbuild-question-media','00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000031/rejected.pdf');
    raise exception 'different author could attach to a draft';
  exception when insufficient_privilege then null;
  end;
end
$$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000013',true);
do $$
begin
  assert (select count(*) from storage.objects where name = 'legacy-reply.pdf') = 1,
    'an authorized recipient can read linked legacy Telegram media';
end
$$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
do $$
begin
  assert (select count(*) from public.sbuild_project_contacts) = 0, 'unassigned profile cannot see contacts';
  assert (select count(*) from public.sbuild_list_project_contacts()) = 0, 'unassigned profile cannot use the contact directory';
  assert (select count(*) from public.sbuild_questions) = 0, 'unassigned profile cannot see questions';
  assert (select count(*) from public.sbuild_question_messages) = 0, 'unassigned profile cannot see messages';
  assert (select count(*) from storage.objects) = 0, 'unassigned profile cannot see files';
end
$$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
do $$
begin
  assert (select count(*) from public.sbuild_project_contacts) = 2, 'owner keeps authorized contact access';
  assert (select count(*) from public.sbuild_list_project_contacts() where link_code is not null) = 2, 'owner can display Telegram linking codes';
  assert (select count(*) from public.sbuild_list_project_contacts() where telegram_connected) = 1, 'owner can identify connected recipients';
  assert (select count(*) from public.sbuild_questions) = 3, 'owner keeps authorized question access';
  assert (select count(*) from storage.objects) = 3, 'owner sees all linked files without unrelated pending uploads';
end
$$;

rollback;
