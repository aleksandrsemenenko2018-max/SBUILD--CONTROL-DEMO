-- Keep the recipient directory usable without exposing Telegram linking credentials.
begin;

create function sbuild_private.list_project_contacts()
returns table (
  id uuid, project_id uuid, name text, role text, phone text, created_at timestamptz,
  telegram_connected boolean, link_code uuid
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.project_id, c.name, c.role, c.phone, c.created_at,
    coalesce(c.telegram_chat_id <> '', false),
    case when (select sbuild_private.is_owner()) then c.link_code else null end
  from public.sbuild_project_contacts c
  where sbuild_private.can_access_project(c.project_id)
$$;

create function public.sbuild_list_project_contacts()
returns table (
  id uuid, project_id uuid, name text, role text, phone text, created_at timestamptz,
  telegram_connected boolean, link_code uuid
)
language sql stable security invoker set search_path = ''
as $$ select * from sbuild_private.list_project_contacts() $$;

revoke execute on function sbuild_private.list_project_contacts() from public, anon;
revoke execute on function public.sbuild_list_project_contacts() from public, anon;
grant execute on function sbuild_private.list_project_contacts() to authenticated;
grant execute on function public.sbuild_list_project_contacts() to authenticated;

revoke select on public.sbuild_project_contacts from public, anon, authenticated;
revoke select (telegram_chat_id, link_code) on public.sbuild_project_contacts from public, anon, authenticated;
grant select (id, project_id, name, role, phone, created_at)
  on public.sbuild_project_contacts to authenticated;

commit;
