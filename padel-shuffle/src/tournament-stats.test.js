import test from 'node:test';
import assert from 'node:assert/strict';
import { playerProfileStats, tournamentLeaderboard } from './tournament-stats.js';

const players = [{ id: 'a', display_name: 'A' }, { id: 'b', display_name: 'B' }, { id: 'c', display_name: 'C' }, { id: 'd', display_name: 'D' }];
const match = { status: 'completed', winner_side: 'a', team_a_player_ids: ['a', 'b'], team_b_player_ids: ['c', 'd'], score_history: ['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a'] };

test('builds an online leaderboard from completed quick-session matches', () => {
  const rows = tournamentLeaderboard(players, [match]);
  assert.equal(rows[0].name, 'A');
  assert.equal(rows[0].wins, 1);
  assert.equal(rows[0].sets, 2);
  assert.equal(rows[0].winRate, 100);
  assert.equal(rows.at(-1).losses, 1);
});

test('summarises a signed-in player across tournament memberships', () => {
  const stats = playerProfileStats([{ id: 'a', tournament_id: 't1' }], [{ ...match, tournament_id: 't1' }]);
  assert.equal(stats.played, 1);
  assert.equal(stats.wins, 1);
  assert.equal(stats.sets, 2);
});

test('keeps all seven players in standings across a one-court rotation', () => {
  const sevenPlayers = Array.from({ length: 7 }, (_, index) => ({ id: `p${index + 1}`, display_name: `Player ${index + 1}` }));
  const completed = [
    { status: 'completed', winner_side: 'a', team_a_player_ids: ['p1', 'p2'], team_b_player_ids: ['p3', 'p4'], score_history: ['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a'] },
    // This models a completed row whose winner flag has not arrived yet. The
    // canonical history still identifies Team B as the winner.
    { status: 'completed', winner_side: null, team_a_player_ids: ['p1', 'p5'], team_b_player_ids: ['p6', 'p7'], score_history: ['b', 'b', 'b', 'b', 'b', 'b', 'b', 'b'] }
  ];
  const rows = tournamentLeaderboard(sevenPlayers, completed);
  const byId = Object.fromEntries(rows.map((row) => [row.playerId, row]));
  assert.equal(rows.length, 7);
  assert.deepEqual({ played: byId.p1.played, wins: byId.p1.wins, losses: byId.p1.losses }, { played: 2, wins: 1, losses: 1 });
  assert.equal(byId.p6.wins, 1);
  assert.equal(byId.p7.wins, 1);
  assert.deepEqual({ played: byId.p5.played, wins: byId.p5.wins, losses: byId.p5.losses }, { played: 1, wins: 0, losses: 1 });
});

test('counts a match once when optimistic and realtime rows overlap', () => {
  const completed = { ...match, id: 'match-once' };
  const rows = tournamentLeaderboard(players, [completed, { ...completed }]);
  const a = rows.find((row) => row.playerId === 'a');
  assert.deepEqual({ played: a.played, wins: a.wins, sets: a.sets }, { played: 1, wins: 1, sets: 2 });
});

test('uses a saved historic score snapshot instead of applying the new format retroactively', () => {
  const historic = {
    id: 'historic-standard-match', status: 'completed', winner_side: 'a',
    team_a_player_ids: ['a', 'b'], team_b_player_ids: ['c', 'd'],
    // The short history would look like two quick-session sets if replayed.
    score_history: ['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a'],
    score_state: {
      complete: true, winner: 'a', format: { mode: 'standard', bestOfSets: 3 },
      sets: [{ a: 6, b: 4 }, { a: 6, b: 0 }], current: { gamesA: 0, gamesB: 0, pointsA: 0, pointsB: 0 }
    }
  };
  const rows = tournamentLeaderboard(players, [historic]);
  assert.equal(rows.find((row) => row.playerId === 'a').sets, 2);
  assert.equal(rows.find((row) => row.playerId === 'c').sets, 0);
});

test('does not count a malformed completed row with no final winner', () => {
  const rows = tournamentLeaderboard(players, [{ id: 'not-final', status: 'completed', team_a_player_ids: ['a', 'b'], team_b_player_ids: ['c', 'd'], score_history: ['a'] }]);
  assert.equal(rows.find((row) => row.playerId === 'a').played, 0);
});
