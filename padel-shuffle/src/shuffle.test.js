import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRound, pairKey, recordRound, roundCapacity } from './shuffle.js';

const ids = Array.from({ length: 7 }, (_, index) => `p${index + 1}`);

test('uses four players and rotates three players for a seven player one-court session', () => {
  const round = makeRound(ids, 1, {}, {}, () => 0.42);
  assert.equal(round.matches.length, 1);
  assert.equal(round.waiting.length, 3);
  assert.equal(new Set(round.matches.flatMap((match) => [...match.teamA, ...match.teamB])).size, 4);
});

test('never repeats a teammate pairing', () => {
  const first = makeRound(ids, 1, {}, {}, () => 0.31);
  const history = recordRound(first);
  const second = makeRound(ids, 1, history.pairCounts, history.playCounts, () => 0.67);
  assert.ok(second);
  second.teams.forEach(([left, right]) => assert.equal(history.pairCounts[pairKey(left, right)] || 0, 0));
});

test('caps courts at the number which can actually play', () => {
  assert.deepEqual(roundCapacity(7, 5), { courts: 1, playing: 4, waiting: 3 });
  assert.deepEqual(roundCapacity(20, 5), { courts: 5, playing: 20, waiting: 0 });
});

test('records opponent history to minimise repeat matchups on later rounds', () => {
  const round = makeRound(['a', 'b', 'c', 'd'], 1, {}, {}, () => 0.3);
  const history = recordRound(round);
  assert.equal(Object.values(history.opponentCounts).reduce((sum, value) => sum + value, 0), 4);
});
