import { supabase } from '../lib/supabase.js';

export function createTournamentSubscription(db, tournamentId, onChange, { debounceMs = 180 } = {}) {
  let timer = null;
  let inFlight = false;
  let queued = false;
  let stopped = false;

  const refresh = async () => {
    if (stopped) return;
    if (inFlight) { queued = true; return; }
    inFlight = true;
    try {
      await onChange();
    } finally {
      inFlight = false;
      if (queued) { queued = false; schedule(); }
    }
  };
  const schedule = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, debounceMs);
  };
  const channel = db
    .channel(`tournament:${tournamentId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tournamentId}` }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_players', filter: `tournament_id=eq.${tournamentId}` }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `tournament_id=eq.${tournamentId}` }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` }, schedule)
    .subscribe();
  return () => {
    stopped = true;
    clearTimeout(timer);
    db.removeChannel(channel);
  };
}

export function subscribeToTournament(tournamentId, onChange, options) {
  if (!supabase) return () => {};
  return createTournamentSubscription(supabase, tournamentId, onChange, options);
}
