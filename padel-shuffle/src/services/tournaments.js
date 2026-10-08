import { supabase } from '../lib/supabase.js';
import { QUICK_SESSION_FORMAT, scoreFromHistory } from '../scoring.js';
import { retryRead } from './query.js';

function client() {
  if (!supabase) throw new Error('Cloud is not configured yet.');
  return supabase;
}

export async function listMyTournaments() {
  const memberships = await retryRead(async () => {
    const { data, error } = await client()
      .from('tournament_players')
      .select('id, role, tournament_id');
    if (error) throw error;
    return data;
  });
  if (!memberships.length) return [];
  // Two small, indexed reads are more reliable than a PostgREST embed when a
  // project contains more than one relationship between these tables.
  const tournaments = await retryRead(async () => {
    const { data, error } = await client()
      .from('tournaments')
      .select('id,name,code,status,created_at,organizer_id,venue,starts_at,ends_at')
      .in('id', memberships.map((membership) => membership.tournament_id))
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  });
  const byId = new Map(tournaments.map((tournament) => [tournament.id, tournament]));
  return memberships
    .map((membership) => ({ ...byId.get(membership.tournament_id), membership: { id: membership.id, role: membership.role } }))
    .filter((tournament) => tournament.id);
}

export async function createTournament({ name, venue, preferredCourts, scoringPermission, startsAt, endsAt }) {
  const { data, error } = await client().rpc('create_tournament', {
    p_name: name,
    p_venue: venue || null,
    p_preferred_courts: preferredCourts,
    p_scoring_permission: scoringPermission,
    p_starts_at: startsAt,
    p_ends_at: endsAt
  });
  if (error) throw error;
  return data;
}

export async function joinTournament(code) {
  const { data, error } = await client().rpc('join_tournament_by_code', { p_code: code.trim().toUpperCase() });
  if (error) throw error;
  return data;
}

export async function loadTournament(tournamentId) {
  return retryRead(async () => {
    const db = client();
    // The live room needs the active matches, not every historic score event.
    // Pair history is loaded only when the host generates a new round.
    const [tournamentResult, playersResult, roundsResult, matchesResult, completedMatchesResult] = await Promise.all([
      db.from('tournaments').select('id,name,venue,code,status,preferred_courts,scoring_permission,organizer_id,created_at,starts_at,ends_at').eq('id', tournamentId).single(),
      db.from('tournament_players').select('id,tournament_id,user_id,display_name,is_guest,role,availability,created_at').eq('tournament_id', tournamentId).order('created_at'),
      db.from('rounds').select('id,tournament_id,number,waiting_player_ids,status,created_at').eq('tournament_id', tournamentId).order('number', { ascending: false }).limit(50),
      db.from('matches').select('id,tournament_id,round_id,court,team_a_player_ids,team_b_player_ids,score_history,score_state,score_version,status,winner_side,completed_at,created_at').eq('tournament_id', tournamentId).eq('status', 'active').order('court'),
      db.from('matches').select('id,tournament_id,round_id,court,team_a_player_ids,team_b_player_ids,score_history,score_state,score_version,status,winner_side,completed_at,created_at').eq('tournament_id', tournamentId).eq('status', 'completed').order('completed_at', { ascending: false })
    ]);
    for (const result of [tournamentResult, playersResult, roundsResult, matchesResult, completedMatchesResult]) {
      if (result.error) throw result.error;
    }
    return {
      tournament: tournamentResult.data,
      players: playersResult.data,
      rounds: roundsResult.data,
      matches: matchesResult.data,
      completedMatches: completedMatchesResult.data
    };
  });
}

export async function loadPairingHistory(tournamentId) {
  return retryRead(async () => {
    const { data, error } = await client()
      .from('matches')
      .select('team_a_player_ids,team_b_player_ids')
      .eq('tournament_id', tournamentId);
    if (error) throw error;
    return data;
  });
}

export async function addGuestPlayer(tournamentId, displayName) {
  const { data, error } = await client().rpc('add_guest_player', {
    p_tournament_id: tournamentId,
    p_display_name: displayName
  });
  if (error) throw error;
  return data;
}

export async function deleteTournament(tournamentId) {
  const { error } = await client().rpc('delete_tournament', { p_tournament_id: tournamentId });
  if (error) throw error;
}

export async function updateTournamentDetails({ tournamentId, name, venue, startsAt, endsAt }) {
  const { data, error } = await client().rpc('update_tournament_details', {
    p_tournament_id: tournamentId,
    p_name: name,
    p_venue: venue,
    p_starts_at: startsAt,
    p_ends_at: endsAt
  });
  if (error) throw error;
  return data;
}

export async function setTournamentArchived(tournamentId, archived) {
  const { data, error } = await client().rpc('set_tournament_archived', { p_tournament_id: tournamentId, p_archived: archived });
  if (error) throw error;
  return data;
}

export async function finishTournament(tournamentId) {
  const { data, error } = await client().rpc('finish_tournament', { p_tournament_id: tournamentId });
  if (error) throw error;
  return data;
}

export async function setMyAvailability(tournamentId, availability) {
  const { data, error } = await client().rpc('set_my_availability', { p_tournament_id: tournamentId, p_availability: availability });
  if (error) throw error;
  return data;
}

export async function removeGuestPlayer(tournamentId, playerId) {
  const { error } = await client().rpc('remove_guest_player', { p_tournament_id: tournamentId, p_player_id: playerId });
  if (error) throw error;
}

export async function undoLastPoint(match) {
  const { data, error } = await client().rpc('undo_last_score_event', {
    p_match_id: match.id,
    p_expected_version: match.score_version,
    p_action_id: crypto.randomUUID()
  });
  if (error) throw error;
  return data;
}

export async function loadMyProfileStats(userId) {
  return retryRead(async () => {
    const { data: memberships, error: membershipError } = await client()
      .from('tournament_players')
      .select('id,tournament_id')
      .eq('user_id', userId);
    if (membershipError) throw membershipError;
    if (!memberships.length) return { memberships: [], matches: [] };
    const { data: matches, error } = await client()
      .from('matches')
      .select('tournament_id,team_a_player_ids,team_b_player_ids,score_history,score_state,status,winner_side')
      .in('tournament_id', memberships.map((membership) => membership.tournament_id))
      .eq('status', 'completed');
    if (error) throw error;
    return { memberships, matches };
  });
}

export async function startRound(tournamentId, matches, waitingPlayerIds) {
  const { data, error } = await client().rpc('create_round_with_matches', {
    p_tournament_id: tournamentId,
    p_matches: matches.map((match) => ({
      court: match.court,
      team_a_player_ids: match.teamA,
      team_b_player_ids: match.teamB
    })),
    p_waiting_player_ids: waitingPlayerIds
  });
  if (error) throw error;
  return data;
}

export async function recordPoint(match, side) {
  // Online games deliberately use the same short Padelé format as Offline:
  // win a set by taking a tennis point sequence, and win the game by taking
  // two sets (with a third set as the decider at 1–1).
  const nextScore = scoreFromHistory([...(match.score_history || []), side], QUICK_SESSION_FORMAT);
  const { data, error } = await client().rpc('record_score_event', {
    p_match_id: match.id,
    p_expected_version: match.score_version,
    p_action_id: crypto.randomUUID(),
    p_side: side,
    p_complete: nextScore.complete,
    p_winner_side: nextScore.winner,
    p_score_state: nextScore.complete ? nextScore : {}
  });
  if (error) throw error;
  return data;
}

export async function setTournamentStatus(tournamentId, status) {
  const { error } = await client().from('tournaments').update({ status }).eq('id', tournamentId);
  if (error) throw error;
}
