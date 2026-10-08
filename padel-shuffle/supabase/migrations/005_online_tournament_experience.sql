-- Online tournament experience: archive/restore, attendance, host controls
-- and an auditable host-only score correction. Run after 001–004.

alter table public.tournaments
  add column if not exists status_before_archive text,
  drop constraint if exists tournaments_status_check;
alter table public.tournaments
  add constraint tournaments_status_check
  check (status in ('lobby', 'active', 'finished', 'archived'));

alter table public.tournament_players
  add column if not exists availability text not null default 'going',
  drop constraint if exists tournament_players_availability_check;
alter table public.tournament_players
  add constraint tournament_players_availability_check
  check (availability in ('going', 'unavailable'));

create or replace function public.update_tournament_details(
  p_tournament_id uuid,
  p_name text,
  p_venue text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns public.tournaments
language plpgsql security definer set search_path = public as $$
declare v_tournament public.tournaments;
begin
  if not public.is_tournament_organizer(p_tournament_id) then
    raise exception 'Only the host can edit this tournament.' using errcode = '42501';
  end if;
  if p_ends_at <= p_starts_at then raise exception 'Choose an end time after the start time.' using errcode = '22007'; end if;
  update public.tournaments set
    name = trim(p_name), venue = nullif(trim(p_venue), ''), starts_at = p_starts_at, ends_at = p_ends_at
  where id = p_tournament_id
  returning * into v_tournament;
  return v_tournament;
end;
$$;

create or replace function public.set_tournament_archived(p_tournament_id uuid, p_archived boolean)
returns public.tournaments
language plpgsql security definer set search_path = public as $$
declare v_tournament public.tournaments;
begin
  if not public.is_tournament_organizer(p_tournament_id) then
    raise exception 'Only the host can archive this tournament.' using errcode = '42501';
  end if;
  if p_archived then
    if exists (select 1 from public.matches where tournament_id = p_tournament_id and status = 'active') then
      raise exception 'Finish every active court before archiving.' using errcode = '55000';
    end if;
    update public.tournaments
      set status_before_archive = status, status = 'archived'
      where id = p_tournament_id and status <> 'archived'
      returning * into v_tournament;
  else
    update public.tournaments
      set status = coalesce(status_before_archive, 'finished'), status_before_archive = null
      where id = p_tournament_id
      returning * into v_tournament;
  end if;
  if v_tournament is null then select * into v_tournament from public.tournaments where id = p_tournament_id; end if;
  return v_tournament;
end;
$$;

create or replace function public.finish_tournament(p_tournament_id uuid)
returns public.tournaments
language plpgsql security definer set search_path = public as $$
declare v_tournament public.tournaments;
begin
  if not public.is_tournament_organizer(p_tournament_id) then
    raise exception 'Only the host can finish this tournament.' using errcode = '42501';
  end if;
  if exists (select 1 from public.matches where tournament_id = p_tournament_id and status = 'active') then
    raise exception 'Finish every active court first.' using errcode = '55000';
  end if;
  update public.tournaments set status = 'finished' where id = p_tournament_id returning * into v_tournament;
  return v_tournament;
end;
$$;

create or replace function public.set_my_availability(p_tournament_id uuid, p_availability text)
returns public.tournament_players
language plpgsql security definer set search_path = public as $$
declare v_player public.tournament_players;
begin
  if p_availability not in ('going', 'unavailable') then raise exception 'Invalid availability.' using errcode = '22023'; end if;
  update public.tournament_players set availability = p_availability
    where tournament_id = p_tournament_id and user_id = auth.uid()
    returning * into v_player;
  if v_player is null then raise exception 'Only signed-in players can update their availability.' using errcode = '42501'; end if;
  return v_player;
end;
$$;

create or replace function public.remove_guest_player(p_tournament_id uuid, p_player_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_organizer(p_tournament_id) then raise exception 'Only the host can remove a player.' using errcode = '42501'; end if;
  if exists (select 1 from public.matches where tournament_id = p_tournament_id) then raise exception 'Players cannot be removed after play has started.' using errcode = '55000'; end if;
  delete from public.tournament_players where id = p_player_id and tournament_id = p_tournament_id and is_guest;
end;
$$;

create or replace function public.undo_last_score_event(p_match_id uuid, p_expected_version integer, p_action_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_match public.matches; v_side text; v_history jsonb; v_version integer;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found.'; end if;
  if not public.is_tournament_organizer(v_match.tournament_id) then raise exception 'Only the host can undo a score.' using errcode = '42501'; end if;
  if v_match.score_version <> p_expected_version then raise exception 'This score changed on another device. Reloaded the latest score.' using errcode = '40001'; end if;
  if jsonb_array_length(v_match.score_history) = 0 then raise exception 'There is no score to undo.' using errcode = '22023'; end if;
  v_side := v_match.score_history ->> (jsonb_array_length(v_match.score_history) - 1);
  v_history := v_match.score_history - (jsonb_array_length(v_match.score_history) - 1);
  v_version := v_match.score_version + 1;
  update public.matches set score_history = v_history, score_version = v_version, status = 'active', winner_side = null, score_state = '{}'::jsonb, completed_at = null where id = p_match_id;
  update public.rounds set status = 'active' where id = v_match.round_id;
  insert into public.match_score_events (match_id, action_id, actor_id, version, side)
  values (p_match_id, p_action_id, auth.uid(), v_version, v_side);
  return jsonb_build_object('score_version', v_version, 'score_history', v_history, 'undone', true);
end;
$$;

grant execute on function public.update_tournament_details(uuid, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.set_tournament_archived(uuid, boolean) to authenticated;
grant execute on function public.finish_tournament(uuid) to authenticated;
grant execute on function public.set_my_availability(uuid, text) to authenticated;
grant execute on function public.remove_guest_player(uuid, uuid) to authenticated;
grant execute on function public.undo_last_score_event(uuid, integer, uuid) to authenticated;
notify pgrst, 'reload schema';
