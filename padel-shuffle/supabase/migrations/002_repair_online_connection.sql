-- Run this once if 001_padele.sql was already applied before this repair.
-- It replaces the room-code generator without touching existing data.

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

grant execute on function public.create_tournament(text, text, smallint, text) to authenticated;
notify pgrst, 'reload schema';
