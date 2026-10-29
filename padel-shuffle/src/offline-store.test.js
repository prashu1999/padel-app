import test from 'node:test';
import assert from 'node:assert/strict';
import { QUICK_SESSION_FORMAT, scoreFromHistory } from './scoring.js';
import { playerStats } from './offline-store.js';

const players = ['A', 'B', 'C', 'D'].map((name, index) => ({ id: `p${index + 1}`, name }));

function completedScore(history) {
  return scoreFromHistory(history, QUICK_SESSION_FORMAT);
}

test('counts a completed current offline game immediately, before the next shuffle', () => {
  const score = completedScore(['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'a', 'a', 'a', 'a']);
  const stats = playerStats({
    players,
    history: [],
    matches: [{ teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], score }]
  });
  const byId = Object.fromEntries(stats.map((row) => [row.id, row]));
  assert.deepEqual({ played: byId.p1.played, wins: byId.p1.wins, sets: byId.p1.sets, points: byId.p1.points }, { played: 1, wins: 1, sets: 2, points: 8 });
  assert.deepEqual({ played: byId.p3.played, losses: byId.p3.losses, sets: byId.p3.sets, points: byId.p3.points }, { played: 1, losses: 1, sets: 1, points: 4 });
});

test('counts historic offline games once using their saved score snapshot', () => {
  const score = completedScore(['b', 'b', 'b', 'b', 'b', 'b', 'b', 'b']);
  const stats = playerStats({
    players,
    matches: [],
    history: [{ winner: ['p3', 'p4'], loser: ['p1', 'p2'], score }]
  });
  const byId = Object.fromEntries(stats.map((row) => [row.id, row]));
  assert.deepEqual({ played: byId.p3.played, wins: byId.p3.wins, sets: byId.p3.sets }, { played: 1, wins: 1, sets: 2 });
  assert.deepEqual({ played: byId.p1.played, losses: byId.p1.losses, sets: byId.p1.sets }, { played: 1, losses: 1, sets: 0 });
});

test('keeps played, wins and losses correct across saved and just-finished games', () => {
  const playersInSession = Array.from({ length: 8 }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}` }));
  const teamAWin = completedScore(['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a']);
  const teamBWin = completedScore(['b', 'b', 'b', 'b', 'b', 'b', 'b', 'b']);
  const decidingTeamBWin = completedScore([
    'a', 'a', 'a', 'a',
    'b', 'b', 'b', 'b',
    'b', 'b', 'b', 'b'
  ]);
  const stats = playerStats({
    players: playersInSession,
    history: [
      { winner: ['p1', 'p2'], loser: ['p3', 'p4'], score: teamAWin },
      { winner: ['p7', 'p8'], loser: ['p5', 'p6'], score: teamBWin }
    ],
    matches: [{ teamA: ['p1', 'p3'], teamB: ['p5', 'p7'], score: decidingTeamBWin }]
  });
  const byId = Object.fromEntries(stats.map((row) => [row.id, row]));
  assert.deepEqual([byId.p1.played, byId.p1.wins, byId.p1.losses], [2, 1, 1]);
  assert.deepEqual([byId.p3.played, byId.p3.wins, byId.p3.losses], [2, 0, 2]);
  assert.deepEqual([byId.p5.played, byId.p5.wins, byId.p5.losses], [2, 1, 1]);
  assert.deepEqual([byId.p7.played, byId.p7.wins, byId.p7.losses], [2, 2, 0]);
  assert.deepEqual([byId.p2.played, byId.p2.wins, byId.p2.losses], [1, 1, 0]);
  assert.deepEqual([byId.p4.played, byId.p4.wins, byId.p4.losses], [1, 0, 1]);
  assert.deepEqual([byId.p6.played, byId.p6.wins, byId.p6.losses], [1, 0, 1]);
  assert.deepEqual([byId.p8.played, byId.p8.wins, byId.p8.losses], [1, 1, 0]);
});
