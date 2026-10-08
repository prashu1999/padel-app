-- Scheduled Padelé tournaments. Run after migrations 001–003.
-- Finished rooms are retained; the app hides a host's room from their dashboard
-- two hours after its scheduled end so results stay recoverable.

alter table public.tournaments
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz;

alter table public.tournaments
  drop constraint if exists tournaments_schedule_valid;
alter table public.tournaments
  add constraint tournaments_schedule_valid
  check (starts_at is null or ends_at is null or ends_at > starts_at);

create index if not exists tournaments_organizer_ends_at_idx
  on public.tournaments (organizer_id, ends_at desc);

-- Replace the original four-argument RPC with the scheduled version. Existing
-- tournaments keep their data and simply have no scheduled time.
drop function if exists public.create_tournament(text, text, smallint, text);
create function public.create_tournament(
  p_name text,
  p_venue text default null,
  p_preferred_courts smallint default 1,
  p_scoring_permission text default 'all_players',
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
) returns public.tournaments
language plpgsql security definer set search_path = public as $$
declare v_tournament public.tournaments; v_code char(6); v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in is required.' using errcode = '42501'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Choose a valid start and end time.' using errcode = '22007';
  end if;
  insert into public.profiles (id, display_name)
  select u.id, coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'), ''), split_part(u.email, '@', 1))
  from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
  v_name := trim(p_name);
  if char_length(v_name) not between 1 and 80 then raise exception 'Tournament name must be 1–80 characters.'; end if;
  if p_preferred_courts not between 1 and 5 then raise exception 'Choose between 1 and 5 courts.'; end if;
  if p_scoring_permission not in ('all_players', 'organizers') then raise exception 'Invalid scoring permission.'; end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text || auth.uid()::text), 1, 6));
    exit when not exists (select 1 from public.tournaments where code = v_code);
  end loop;
  insert into public.tournaments (organizer_id, name, venue, code, preferred_courts, scoring_permission, starts_at, ends_at)
  values (auth.uid(), v_name, nullif(trim(p_venue), ''), v_code, p_preferred_courts, p_scoring_permission, p_starts_at, p_ends_at)
  returning * into v_tournament;
  insert into public.tournament_players (tournament_id, user_id, display_name, is_guest, role)
  select v_tournament.id, auth.uid(), p.display_name, false, 'organizer'
  from public.profiles p where p.id = auth.uid();
  return v_tournament;
end;
$$;

-- Only the host may use this. Cascading foreign keys remove the room's
-- dependent players, rounds, matches and score events in one transaction.
create or replace function public.delete_tournament(p_tournament_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_organizer(p_tournament_id) then
    raise exception 'Only the host can delete this tournament.' using errcode = '42501';
  end if;
  delete from public.tournaments where id = p_tournament_id;
end;
$$;

grant execute on function public.create_tournament(text, text, smallint, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.delete_tournament(uuid) to authenticated;
notify pgrst, 'reload schema';
