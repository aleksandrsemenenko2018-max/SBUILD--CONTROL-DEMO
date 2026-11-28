-- Add typed nodes without reclassifying existing zones or changing their IDs.
begin;

alter table public.sbuild_zones add column kind text;
alter table public.sbuild_zones add constraint sbuild_zones_typed_shape check (
  kind is null or (
    name is not null and char_length(name) between 1 and 120
    and (
      (kind = 'floor' and parent_id is null)
      or (kind = 'room' and parent_id is not null)
      or (kind = 'segment' and parent_id is not null and name collate "C" ~ '^[A-G]$')
    )
  )
);

create unique index sbuild_zones_project_floor_name_idx
  on public.sbuild_zones (project_id, lower(name)) where kind = 'floor';
create unique index sbuild_zones_parent_room_name_idx
  on public.sbuild_zones (parent_id, lower(name)) where kind = 'room';
create unique index sbuild_zones_parent_segment_name_idx
  on public.sbuild_zones (parent_id, name) where kind = 'segment';

create function sbuild_private.enforce_typed_zone()
returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.kind is not null or old.kind is not null)
      and row(new.id, new.project_id, new.kind, new.parent_id) is distinct from
          row(old.id, old.project_id, old.kind, old.parent_id) then
    raise check_violation using message = 'A typed zone cannot be moved or reclassified';
  end if;
  if new.kind is null then return new; end if;

  new.name := btrim(new.name);
  if new.kind = 'segment' then new.name := upper(new.name); end if;

  if new.kind in ('room', 'segment') and not exists (
    select 1 from public.sbuild_zones parent
    where parent.id = new.parent_id and parent.project_id = new.project_id
      and parent.kind = case when new.kind = 'room' then 'floor' else 'room' end
  ) then
    raise check_violation using message = 'The parent type and project must match the zone hierarchy';
  end if;
  return new;
end;
$$;
revoke execute on function sbuild_private.enforce_typed_zone() from public, anon, authenticated;
create trigger enforce_typed_zone
  before insert or update on public.sbuild_zones
  for each row execute function sbuild_private.enforce_typed_zone();

notify pgrst, 'reload schema';
commit;
