-- Padelé online schema. Run this in the Supabase SQL editor (or `supabase db push`).
-- The browser only ever receives the project's publishable key; all authority
-- below is based on auth.uid() and Row Level Security.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 80),
  venue text check (venue is null or char_length(trim(venue)) <= 120),
  code char(6) not null unique,
  status text not null default 'lobby' check (status in ('lobby', 'active', 'finished')),
  preferred_courts smallint not null default 1 check (preferred_courts between 1 and 5),
  scoring_permission text not null default 'all_players' check (scoring_permission in ('all_players', 'organizers')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  is_guest boolean not null default false,
  role text not null default 'player' check (role in ('organizer', 'player')),
  created_at timestamptz not null default now(),
  check ((is_guest and user_id is null) or ((not is_guest) and user_id is not null))
);
create unique index if not exists tournament_players_member_idx on public.tournament_players(tournament_id, user_id) where user_id is not null;
create unique index if not exists tournament_players_name_idx on public.tournament_players(tournament_id, lower(display_name));

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  number integer not null check (number > 0),
  waiting_player_ids uuid[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'completed')),
  created_at timestamptz not null default now(),
  unique (tournament_id, number)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  court smallint not null check (court between 1 and 5),
  team_a_player_ids uuid[] not null check (cardinality(team_a_player_ids) = 2),
  team_b_player_ids uuid[] not null check (cardinality(team_b_player_ids) = 2),
  score_history jsonb not null default '[]'::jsonb check (jsonb_typeof(score_history) = 'array'),
  score_state jsonb not null default '{}'::jsonb check (jsonb_typeof(score_state) = 'object'),
  score_version integer not null default 0 check (score_version >= 0),
  status text not null default 'active' check (status in ('active', 'completed')),
  winner_side text check (winner_side in ('a', 'b')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (not (team_a_player_ids && team_b_player_ids)),
  unique (round_id, court)
);
create index if not exists matches_tournament_idx on public.matches(tournament_id, created_at);

create table if not exists public.match_score_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  action_id uuid not null unique,
  actor_id uuid not null references auth.users(id) on delete restrict,
  version integer not null,
  side text not null check (side in ('a', 'b')),
  created_at timestamptz not null default now(),
  unique (match_id, version)
);

-- Kept for analytics/export. A server job may materialise it from completed
-- event histories; the browser uses the same pure scoring engine everywhere.
create table if not exists public.player_stats (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.tournament_players(id) on delete cascade,
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  sets integer not null default 0 check (sets >= 0),
  games integer not null default 0 check (games >= 0),
  points integer not null default 0 check (points >= 0),
  updated_at timestamptz not null default now(),
  primary key (tournament_id, player_id)
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists tournaments_updated_at on public.tournaments;
create trigger tournaments_updated_at before update on public.tournaments for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Security-definer membership predicates prevent circular RLS lookups while
-- remaining bound to the currently authenticated user.
create or replace function public.is_tournament_member(p_tournament_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournament_players
    where tournament_id = p_tournament_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_tournament_organizer(p_tournament_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournaments
    where id = p_tournament_id and organizer_id = auth.uid()
  );
$$;

create or replace function public.can_score_tournament(p_tournament_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournaments t
    where t.id = p_tournament_id
      and ((t.scoring_permission = 'all_players' and public.is_tournament_member(t.id))
        or (t.scoring_permission = 'organizers' and t.organizer_id = auth.uid()))
  );
$$;

alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_players enable row level security;
alter table public.rounds enable row level security;
alter table public.matches enable row level security;
alter table public.match_score_events enable row level security;
alter table public.player_stats enable row level security;

drop policy if exists "profiles are visible to authenticated users" on public.profiles;
create policy "profiles are visible to authenticated users" on public.profiles for select to authenticated using (true);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "members read tournaments" on public.tournaments;
create policy "members read tournaments" on public.tournaments for select to authenticated using (public.is_tournament_member(id));
drop policy if exists "organizers update tournaments" on public.tournaments;
create policy "organizers update tournaments" on public.tournaments for update to authenticated using (organizer_id = auth.uid()) with check (organizer_id = auth.uid());

drop policy if exists "members read players" on public.tournament_players;
create policy "members read players" on public.tournament_players for select to authenticated using (public.is_tournament_member(tournament_id));
drop policy if exists "members read rounds" on public.rounds;
create policy "members read rounds" on public.rounds for select to authenticated using (public.is_tournament_member(tournament_id));
drop policy if exists "members read matches" on public.matches;
create policy "members read matches" on public.matches for select to authenticated using (public.is_tournament_member(tournament_id));
drop policy if exists "members read score events" on public.match_score_events;
create policy "members read score events" on public.match_score_events for select to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_member(m.tournament_id))
);
drop policy if exists "members read player stats" on public.player_stats;
create policy "members read player stats" on public.player_stats for select to authenticated using (public.is_tournament_member(tournament_id));

create or replace function public.create_tournament(
  p_name text,
  p_venue text default null,
  p_preferred_courts smallint default 1,
  p_scoring_permission text default 'all_players'
) returns public.tournaments
language plpgsql security definer set search_path = public as $$
declare v_tournament public.tournaments; v_code char(6); v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in is required.' using errcode = '42501'; end if;
  insert into public.profiles (id, display_name)
  select u.id, coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'), ''), split_part(u.email, '@', 1))
  from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
  v_name := trim(p_name);
  if char_length(v_name) not between 1 and 80 then raise exception 'Tournament name must be 1–80 characters.'; end if;
  if p_preferred_courts not between 1 and 5 then raise exception 'Choose between 1 and 5 courts.'; end if;
  if p_scoring_permission not in ('all_players', 'organizers') then raise exception 'Invalid scoring permission.'; end if;
  loop
    -- Avoid an extension-specific generator: this works on every Supabase
    -- PostgreSQL project while the loop still guarantees code uniqueness.
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text || auth.uid()::text), 1, 6));
    exit when not exists (select 1 from public.tournaments where code = v_code);
  end loop;
  insert into public.tournaments (organizer_id, name, venue, code, preferred_courts, scoring_permission)
  values (auth.uid(), v_name, nullif(trim(p_venue), ''), v_code, p_preferred_courts, p_scoring_permission)
  returning * into v_tournament;
  insert into public.tournament_players (tournament_id, user_id, display_name, is_guest, role)
  select v_tournament.id, auth.uid(), p.display_name, false, 'organizer' from public.profiles p where p.id = auth.uid();
  return v_tournament;
end;
$$;

create or replace function public.join_tournament_by_code(p_code text)
returns public.tournaments
language plpgsql security definer set search_path = public as $$
declare v_tournament public.tournaments;
begin
  if auth.uid() is null then raise exception 'Sign in is required.' using errcode = '42501'; end if;
  insert into public.profiles (id, display_name)
  select u.id, coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'), ''), split_part(u.email, '@', 1))
  from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
  select * into v_tournament from public.tournaments where code = upper(trim(p_code));
  if not found then raise exception 'That room code was not found.'; end if;
  if v_tournament.status = 'finished' then raise exception 'This tournament has finished.'; end if;
  insert into public.tournament_players (tournament_id, user_id, display_name, is_guest)
  select v_tournament.id, auth.uid(), p.display_name, false from public.profiles p where p.id = auth.uid()
  on conflict (tournament_id, user_id) where user_id is not null do nothing;
  return v_tournament;
end;
$$;

create or replace function public.add_guest_player(p_tournament_id uuid, p_display_name text)
returns public.tournament_players
language plpgsql security definer set search_path = public as $$
declare v_player public.tournament_players; v_name text := trim(p_display_name);
begin
  if not public.is_tournament_organizer(p_tournament_id) then raise exception 'Only the host can add guests.' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 40 then raise exception 'Guest name must be 1–40 characters.'; end if;
  insert into public.tournament_players (tournament_id, display_name, is_guest)
  values (p_tournament_id, v_name, true) returning * into v_player;
  return v_player;
end;
$$;

create or replace function public.create_round_with_matches(
  p_tournament_id uuid,
  p_matches jsonb,
  p_waiting_player_ids uuid[] default '{}'
) returns public.rounds
language plpgsql security definer set search_path = public as $$
declare v_round public.rounds; v_number integer; v_item jsonb; v_a uuid[]; v_b uuid[]; v_seen uuid[] := '{}'; v_id uuid;
begin
  if not public.is_tournament_organizer(p_tournament_id) then raise exception 'Only the host can shuffle a round.' using errcode = '42501'; end if;
  if jsonb_typeof(p_matches) <> 'array' or jsonb_array_length(p_matches) < 1 then raise exception 'At least one match is required.'; end if;
  if jsonb_array_length(p_matches) > 5 then raise exception 'A maximum of five courts is supported.'; end if;
  perform 1 from public.tournaments where id = p_tournament_id for update;
  if exists (select 1 from public.matches where tournament_id = p_tournament_id and status = 'active') then raise exception 'Finish every active match before shuffling another round.'; end if;
  select coalesce(max(number), 0) + 1 into v_number from public.rounds where tournament_id = p_tournament_id;
  foreach v_id in array p_waiting_player_ids loop
    if not exists (select 1 from public.tournament_players where tournament_id = p_tournament_id and id = v_id) then raise exception 'Unknown waiting player.'; end if;
  end loop;
  for v_item in select value from jsonb_array_elements(p_matches) loop
    select coalesce(array_agg(value::text::uuid), '{}') into v_a from jsonb_array_elements_text(v_item->'team_a_player_ids');
    select coalesce(array_agg(value::text::uuid), '{}') into v_b from jsonb_array_elements_text(v_item->'team_b_player_ids');
    if cardinality(v_a) <> 2 or cardinality(v_b) <> 2 or v_a && v_b then raise exception 'Each court needs two distinct teams of two.'; end if;
    if exists (select 1 from unnest(v_a || v_b) id where id = any(v_seen)) then raise exception 'A player cannot be on two courts.'; end if;
    v_seen := v_seen || v_a || v_b;
    if exists (select 1 from unnest(v_a || v_b) id where not exists (select 1 from public.tournament_players p where p.tournament_id = p_tournament_id and p.id = id)) then raise exception 'A listed player is not in this room.'; end if;
    if exists (select 1 from public.matches m where m.tournament_id = p_tournament_id and ((m.team_a_player_ids @> v_a and cardinality(m.team_a_player_ids) = 2) or (m.team_b_player_ids @> v_a and cardinality(m.team_b_player_ids) = 2) or (m.team_a_player_ids @> v_b and cardinality(m.team_a_player_ids) = 2) or (m.team_b_player_ids @> v_b and cardinality(m.team_b_player_ids) = 2))) then raise exception 'Padelé does not allow teammate pairs to repeat.'; end if;
  end loop;
  insert into public.rounds (tournament_id, number, waiting_player_ids) values (p_tournament_id, v_number, p_waiting_player_ids) returning * into v_round;
  for v_item in select value from jsonb_array_elements(p_matches) loop
    select array_agg(value::text::uuid) into v_a from jsonb_array_elements_text(v_item->'team_a_player_ids');
    select array_agg(value::text::uuid) into v_b from jsonb_array_elements_text(v_item->'team_b_player_ids');
    insert into public.matches (tournament_id, round_id, court, team_a_player_ids, team_b_player_ids)
    values (p_tournament_id, v_round.id, (v_item->>'court')::smallint, v_a, v_b);
  end loop;
  update public.tournaments set status = 'active' where id = p_tournament_id;
  return v_round;
end;
$$;

create or replace function public.record_score_event(
  p_match_id uuid,
  p_expected_version integer,
  p_action_id uuid,
  p_side text,
  p_complete boolean default false,
  p_winner_side text default null,
  p_score_state jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_match public.matches; v_version integer;
begin
  if auth.uid() is null then raise exception 'Sign in is required.' using errcode = '42501'; end if;
  if p_side not in ('a', 'b') then raise exception 'Invalid team side.'; end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found.'; end if;
  if not public.can_score_tournament(v_match.tournament_id) then raise exception 'You do not have scoring permission.' using errcode = '42501'; end if;
  if exists (select 1 from public.match_score_events where action_id = p_action_id) then
    return jsonb_build_object('idempotent', true, 'score_version', v_match.score_version, 'score_history', v_match.score_history);
  end if;
  if v_match.status = 'completed' then raise exception 'This match is already complete.'; end if;
  if v_match.score_version <> p_expected_version then raise exception 'This score changed on another device. Reloaded the latest score.' using errcode = '40001'; end if;
  if p_complete and (p_winner_side not in ('a', 'b') or jsonb_typeof(p_score_state) <> 'object') then raise exception 'Invalid completed score.'; end if;
  v_version := v_match.score_version + 1;
  update public.matches set
    score_history = score_history || jsonb_build_array(p_side),
    score_version = v_version,
    status = case when p_complete then 'completed' else status end,
    winner_side = case when p_complete then p_winner_side else winner_side end,
    score_state = case when p_complete then p_score_state else score_state end,
    completed_at = case when p_complete then now() else completed_at end
  where id = p_match_id;
  insert into public.match_score_events (match_id, action_id, actor_id, version, side) values (p_match_id, p_action_id, auth.uid(), v_version, p_side);
  if p_complete and not exists (select 1 from public.matches where round_id = v_match.round_id and status = 'active') then
    update public.rounds set status = 'completed' where id = v_match.round_id;
  end if;
  return jsonb_build_object('idempotent', false, 'score_version', v_version, 'score_history', v_match.score_history || jsonb_build_array(p_side));
end;
$$;

revoke all on all tables in schema public from anon;
grant select, update on public.profiles to authenticated;
grant select, update on public.tournaments to authenticated;
grant select on public.tournament_players, public.rounds, public.matches, public.match_score_events, public.player_stats to authenticated;
grant execute on function public.create_tournament(text, text, smallint, text) to authenticated;
grant execute on function public.join_tournament_by_code(text) to authenticated;
grant execute on function public.add_guest_player(uuid, text) to authenticated;
grant execute on function public.create_round_with_matches(uuid, jsonb, uuid[]) to authenticated;
grant execute on function public.record_score_event(uuid, integer, uuid, text, boolean, text, jsonb) to authenticated;

-- Realtime needs these tables in the `supabase_realtime` publication. This is
-- safe to rerun: duplicate-object errors are ignored on already-enabled tables.
do $$ begin
  alter publication supabase_realtime add table public.tournaments, public.tournament_players, public.rounds, public.matches;
exception when duplicate_object then null;
end $$;
