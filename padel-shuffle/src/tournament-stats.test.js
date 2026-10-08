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
