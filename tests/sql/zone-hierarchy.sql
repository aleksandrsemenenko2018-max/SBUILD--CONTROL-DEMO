begin;
insert into public.sbuild_projects values
 ('00000000-0000-4000-8000-000000000401'), ('00000000-0000-4000-8000-000000000402');
insert into public.sbuild_profiles values
 ('00000000-0000-4000-8000-000000000501', 'Owner', 'owner', true),
 ('00000000-0000-4000-8000-000000000502', 'Foreman', 'foreman', true),
 ('00000000-0000-4000-8000-000000000503', 'Worker', 'worker', true);
insert into public.sbuild_project_members values
 ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000502'),
 ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000503');
insert into public.sbuild_zones (id, project_id, name)
values ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000401', 'Legacy');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000501', true);
insert into public.sbuild_zones (id, project_id, name, kind)
values ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000402', 'Floor East', 'floor');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000502', true);
do $$
declare
  project constant uuid := '00000000-0000-4000-8000-000000000401';
  foreign_project constant uuid := '00000000-0000-4000-8000-000000000402';
  foreign_floor constant uuid := '00000000-0000-4000-8000-000000000602';
  floor_id uuid;
  room_id uuid;
  segment_id uuid;
begin
  insert into public.sbuild_zones (project_id, name, kind) values (project, 'Floor One', 'floor') returning id into floor_id;
  insert into public.sbuild_zones (project_id, parent_id, name, kind)
    values (project, floor_id, 'Room 100', 'room') returning id into room_id;
  insert into public.sbuild_zones (project_id, parent_id, name, kind)
    values (project, room_id, ' a ', 'segment') returning id into segment_id;
  if not exists (select 1 from public.sbuild_zones where id = segment_id and name = 'A') then
    raise exception 'Segment normalization failed';
  end if;
  update public.sbuild_zones set name = 'Room 102' where id = room_id;
  if not exists (select 1 from public.sbuild_zones where id = room_id and parent_id = floor_id and name = 'Room 102') then
    raise exception 'Room rename failed';
  end if;
  begin
    insert into public.sbuild_zones (project_id, name, kind) values (foreign_project, 'Invisible', 'floor');
    raise exception 'Foreman created a floor on an unrelated project';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.sbuild_zones (project_id, parent_id, name, kind) values (project, foreign_floor, 'Foreign', 'room');
    raise exception 'Cross-project parent was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.sbuild_zones (project_id, parent_id, name, kind) values (project, floor_id, 'B', 'segment');
    raise exception 'Segment directly on floor was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.sbuild_zones (project_id, parent_id, name, kind) values (project, room_id, 'H', 'segment');
    raise exception 'Out of range segment was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.sbuild_zones (project_id, parent_id, name, kind) values (project, room_id, 'A', 'segment');
    raise exception 'Duplicate segment was accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.sbuild_zones set parent_id = segment_id where id = room_id;
    raise exception 'Moving or cycling a typed room was accepted';
  exception when check_violation then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000503', true);
do $$
begin
  if (select count(*) from public.sbuild_zones) <> 4 then
    raise exception 'Worker did not see only member-project zones and legacy rows';
  end if;
  begin
    insert into public.sbuild_zones (project_id, name, kind)
    values ('00000000-0000-4000-8000-000000000401', 'Unapproved floor', 'floor');
    raise exception 'Worker created a typed zone';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
