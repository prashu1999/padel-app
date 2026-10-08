import { QUICK_SESSION_FORMAT, matchSetsWon, scoreFromHistory } from './scoring.js';

function empty(player) {
  return { playerId: player.id, name: player.display_name || player.name || 'Player', played: 0, wins: 0, losses: 0, sets: 0, points: 0, winRate: 0 };
}

export function tournamentLeaderboard(players = [], completedMatches = []) {
  const stats = new Map(players.map((player) => [player.id, empty(player)]));
  completedMatches.forEach((match) => {
    if (match.status !== 'completed' || !match.winner_side) return;
    const score = scoreFromHistory(match.score_history || [], QUICK_SESSION_FORMAT);
    [['a', match.team_a_player_ids || []], ['b', match.team_b_player_ids || []]].forEach(([side, ids]) => {
      ids.forEach((id) => {
        const row = stats.get(id);
        if (!row) return;
        row.played += 1;
        row.sets += matchSetsWon(score, side);
        row.points += (match.score_history || []).filter((winner) => winner === side).length;
        if (match.winner_side === side) row.wins += 1;
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
