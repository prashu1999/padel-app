const STORAGE_KEY = 'padele-offline-v2';

import { QUICK_SESSION_FORMAT, matchSetsWon, scoreFromHistory } from './scoring.js';

export function newOfflineSession(players, courts, voiceEnabled) {
  const playerRows = players.map((name, index) => ({
    id: `local-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    name
  }));
  return {
    version: 2,
    kind: 'offline',
    scoringMode: 'quick-session',
    startedAt: new Date().toISOString(),
    players: playerRows,
    preferredCourts: courts,
    voiceEnabled,
    roundNumber: 0,
    pairCounts: {},
    opponentCounts: {},
    playCounts: Object.fromEntries(playerRows.map((player) => [player.id, 0])),
    matches: [],
    history: [],
    completed: false
  };
}

export function loadOfflineSession() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (![2, 3].includes(value?.version) || !Array.isArray(value.players)) return null;
    // Restore any brief direct-set build to the individual score format used
    // by Padelé sessions. Existing event histories remain the source of truth.
    if (value.scoringMode !== 'quick-session') {
      value.version = 2;
      value.scoringMode = 'quick-session';
      value.matches = (value.matches || []).map((match) => ({
        ...match,
        score: scoreFromHistory(match.score?.history || [], QUICK_SESSION_FORMAT)
      }));
      value.history = (value.history || []).map((entry) => ({
        ...entry,
        score: entry.score ? scoreFromHistory(entry.score.history || [], QUICK_SESSION_FORMAT) : entry.score
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    }
    return value;
  } catch {
    return null;
  }
}

export function saveOfflineSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearOfflineSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function playerStats(session) {
  const stats = Object.fromEntries(session.players.map((player) => [player.id, {
    id: player.id,
    name: player.name,
    played: 0,
    wins: 0,
    losses: 0,
    sets: 0,
    points: 0
  }]));
  // A just-finished court must appear on the board before the host taps
  // “shuffle next round”. Previously it was omitted until that later action.
  const currentCompleted = (session.matches || [])
    .filter((match) => match.score?.complete)
    .map((match) => ({
      winner: match.score.winner === 'a' ? match.teamA : match.teamB,
      loser: match.score.winner === 'a' ? match.teamB : match.teamA,
      score: match.score
    }));

  [...(session.history || []), ...currentCompleted].forEach((entry) => {
    entry.winner.forEach((id) => {
      stats[id].played += 1;
      stats[id].wins += 1;
    });
    entry.loser.forEach((id) => {
      stats[id].played += 1;
      stats[id].losses += 1;
    });
    // Recalculate from the saved score whenever it is available. This keeps
    // older sessions correct even though an earlier UI called set totals
    // “games”. The fallback preserves any pre-existing saved session data.
    if (entry.score) {
      // `winner`/`loser` are player lists, while the score uses team sides.
      // A Team B win used to attach Team A's set and point totals to winners.
      const winningSide = entry.score.winner;
      [['a', winningSide === 'a' ? entry.winner : entry.loser], ['b', winningSide === 'b' ? entry.winner : entry.loser]].forEach(([side, ids]) => {
        const setWins = matchSetsWon(entry.score, side);
        const points = (entry.score.history || []).filter((winner) => winner === side).length;
        ids.forEach((id) => {
          stats[id].sets += setWins;
          stats[id].points += points;
        });
      });
    } else {
      Object.entries(entry.totals || {}).forEach(([id, totals]) => {
        stats[id].sets += totals.sets || 0;
        stats[id].points += totals.points || 0;
      });
    }
  });
  return Object.values(stats).sort((left, right) => right.wins - left.wins || right.sets - left.sets || right.points - left.points || left.name.localeCompare(right.name));
}
