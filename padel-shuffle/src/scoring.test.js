import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPoint, createScore, isTiebreak, pointLabel, QUICK_SESSION_FORMAT, scoreFromHistory, undoPoint } from './scoring.js';

function add(score, side, times) {
  let next = score;
  for (let index = 0; index < times; index += 1) next = applyPoint(next, side);
  return next;
}

test('uses tennis points, deuce and advantage before a game', () => {
  let score = add(createScore(), 'a', 3);
  score = add(score, 'b', 3);
  assert.equal(pointLabel(score, 'a'), '40');
  score = applyPoint(score, 'a');
  assert.equal(pointLabel(score, 'a'), 'Ad');
  score = applyPoint(score, 'b');
  assert.equal(pointLabel(score, 'a'), '40');
  score = applyPoint(score, 'b');
  score = applyPoint(score, 'b');
  assert.equal(score.current.gamesB, 1);
});

test('awards a standard 6–0 set and completes best of three at two sets', () => {
  let score = createScore();
  score = add(score, 'a', 24);
  assert.deepEqual(score.sets[0], { a: 6, b: 0 });
  score = add(score, 'a', 24);
  assert.equal(score.complete, true);
  assert.equal(score.winner, 'a');
});

test('plays a win-by-two tiebreak at 6–6 and preserves its score', () => {
  let score = createScore();
  for (let game = 0; game < 6; game += 1) {
    score = add(score, 'a', 4);
    score = add(score, 'b', 4);
  }
  assert.equal(isTiebreak(score), true);
  for (let point = 0; point < 6; point += 1) {
    score = applyPoint(score, 'a');
    score = applyPoint(score, 'b');
  }
  score = applyPoint(score, 'a');
  score = applyPoint(score, 'a');
  assert.deepEqual(score.sets[0], { a: 7, b: 6, tiebreak: { a: 8, b: 6 } });
});

test('undo rebuilds score from the point event history', () => {
  const score = add(createScore(), 'a', 4);
  const undone = undoPoint(score);
  assert.equal(score.current.gamesA, 1);
  assert.equal(undone.current.gamesA, 0);
  assert.equal(undone.current.pointsA, 3);
});

test('rehydrates a score from its canonical point event history', () => {
  const score = scoreFromHistory(['a', 'a', 'b', 'a']);
  assert.deepEqual(score.history, ['a', 'a', 'b', 'a']);
  assert.equal(pointLabel(score, 'a'), '40');
  assert.equal(pointLabel(score, 'b'), '15');
});

test('keeps the original offline quick-session rule: first to two sets wins', () => {
  let score = createScore(QUICK_SESSION_FORMAT);
  score = add(score, 'a', 4);
  assert.equal(score.complete, false);
  assert.equal(score.sets.length, 1);
  score = add(score, 'b', 4);
  assert.equal(score.sets.length, 2);
  score = add(score, 'a', 4);
  assert.equal(score.complete, true);
  assert.equal(score.winner, 'a');
  assert.equal(score.sets.filter((set) => set.a > set.b).length, 2);
});

test('replays an online event history with the same quick-session rule as Offline', () => {
  // Team A wins the opening set, Team B levels it, then A takes the decider.
  const score = scoreFromHistory([
    'a', 'a', 'a', 'a',
    'b', 'b', 'b', 'b',
    'a', 'a', 'a', 'a'
  ], QUICK_SESSION_FORMAT);
  assert.equal(score.complete, true);
  assert.equal(score.winner, 'a');
  assert.deepEqual(score.sets, [{ a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }]);
});
