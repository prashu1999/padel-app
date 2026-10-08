-- Additive performance fixes only: no tables, policies, or data are removed.
-- Run after 001_padele.sql and 002_repair_online_connection.sql.

-- Supports lobby member lists in creation order and membership checks.
create index if not exists tournament_players_tournament_created_idx
  on public.tournament_players (tournament_id, created_at);

-- Supports the bounded round-history query ordered by latest round first.
create index if not exists rounds_tournament_number_desc_idx
  on public.rounds (tournament_id, number desc);

-- Supports the live-room query, which loads active matches for one tournament
-- ordered by court. Completed history is fetched only when generating a round.
create index if not exists matches_active_tournament_court_idx
  on public.matches (tournament_id, court)
  where status = 'active';

-- Existing Realtime choices are intentional: live room tables only.
-- Keep profiles, player_stats, and match_score_events out of publication.
notify pgrst, 'reload schema';
