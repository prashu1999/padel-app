const STORAGE_KEY = 'padele-offline-v2';

import { QUICK_SESSION_FORMAT, scoreFromHistory } from './scoring.js';

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
    if (value?.version !== 2 || !Array.isArray(value.players)) return null;
    // Sessions saved while the rebuild briefly used full tournament scoring are
    // replayed under the restored Offline quick-session rule.
    if (value.scoringMode !== 'quick-session') {
      value.scoringMode = 'quick-session';
      value.matches = (value.matches || []).map((match) => ({
        ...match,
        score: scoreFromHistory(match.score?.history || [], QUICK_SESSION_FORMAT)
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
    games: 0,
    points: 0
  }]));
  session.history.forEach((entry) => {
    entry.winner.forEach((id) => {
      stats[id].played += 1;
      stats[id].wins += 1;
    });
    entry.loser.forEach((id) => {
      stats[id].played += 1;
      stats[id].losses += 1;
    });
    Object.entries(entry.totals || {}).forEach(([id, totals]) => {
      stats[id].sets += totals.sets || 0;
      stats[id].games += totals.games || 0;
      stats[id].points += totals.points || 0;
    });
  });
  return Object.values(stats).sort((left, right) => right.wins - left.wins || right.sets - left.sets || right.games - left.games || left.name.localeCompare(right.name));
}
