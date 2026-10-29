import { QUICK_SESSION_FORMAT, matchSetsWon, scoreFromHistory } from './scoring.js';

function empty(player) {
  return { playerId: player.id, name: player.display_name || player.name || 'Player', played: 0, wins: 0, losses: 0, sets: 0, points: 0, winRate: 0 };
}

function completedScore(match) {
  // A completed match stores its final score snapshot. Prefer that immutable
  // result: it preserves the score format used when an older room was played.
  // Replaying the history is only a fallback for legacy/in-flight records.
  const stored = match.score_state;
  if (stored?.complete && Array.isArray(stored.sets) && stored.current && stored.format) return stored;
  const history = (match.score_history || []).filter((side) => side === 'a' || side === 'b');
  return scoreFromHistory(history, QUICK_SESSION_FORMAT);
}

export function tournamentLeaderboard(players = [], completedMatches = []) {
  const stats = new Map(players.map((player) => [player.id, empty(player)]));
  const countedMatchIds = new Set();
  completedMatches.forEach((match, index) => {
    if (match.status !== 'completed') return;
    // An optimistic completion and a Realtime reload may briefly contain the
    // same match twice. Count every database match once, never every row.
    const matchId = match.id || `legacy-${index}`;
    if (countedMatchIds.has(matchId)) return;
    countedMatchIds.add(matchId);
    const score = completedScore(match);
    // A database winner flag is normally written atomically with the final
    // point. Rebuild it from the event history as a safe fallback for older
    // rooms or a device that briefly displayed a partially synced result.
    const winnerSide = match.winner_side || score.winner;
    // A corrupt/partially written "completed" row is not a game result yet.
    // Leaving it out is safer than inflating the matches-played column.
    if (!winnerSide) return;
    [['a', match.team_a_player_ids || []], ['b', match.team_b_player_ids || []]].forEach(([side, ids]) => {
      ids.forEach((id) => {
        const row = stats.get(id);
        if (!row) return;
        row.played += 1;
        row.sets += matchSetsWon(score, side);
        row.points += (match.score_history || []).filter((winner) => winner === side).length;
        if (winnerSide === side) row.wins += 1;
        else row.losses += 1;
      });
    });
  });
  return [...stats.values()]
    .map((row) => ({ ...row, winRate: row.played ? Math.round((row.wins / row.played) * 100) : 0 }))
    .sort((left, right) => right.wins - left.wins || right.sets - left.sets || right.points - left.points || left.name.localeCompare(right.name));
}

export function playerProfileStats(memberships = [], matches = []) {
  const membershipByTournament = new Map(memberships.map((membership) => [membership.tournament_id, membership.id]));
  const player = { id: '__profile__', display_name: 'You' };
  const normalised = matches.map((match) => {
    const playerId = membershipByTournament.get(match.tournament_id);
    const inA = (match.team_a_player_ids || []).includes(playerId);
    return {
      ...match,
      team_a_player_ids: inA ? [player.id] : [],
      team_b_player_ids: !inA && (match.team_b_player_ids || []).includes(playerId) ? [player.id] : []
    };
  });
  return tournamentLeaderboard([player], normalised)[0] || empty(player);
}
