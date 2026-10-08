/**
 * The one scoring engine used by both offline play and the online event stream.
 * A point is deliberately the only mutation: the score can always be rebuilt
 * from its point history, which makes retries and undo reliable.
 */
export const SCORE_FORMAT = Object.freeze({
  mode: 'standard',
  bestOfSets: 3,
  gamesToWinSet: 6,
  tiebreakAt: 6,
  tiebreakPoints: 7
});

// The original quick-session rule used by Offline mode: a complete tennis
// point sequence awards one set; first to two sets wins the game.
export const QUICK_SESSION_FORMAT = Object.freeze({
  mode: 'quick-session',
  bestOfSets: 3,
  gamesToWinSet: 1,
  tiebreakAt: null,
  tiebreakPoints: null
});

const POINT_LABELS = ['0', '15', '30', '40'];

export function createScore(format = SCORE_FORMAT) {
  return {
    format: { ...SCORE_FORMAT, ...format },
    sets: [],
    current: { gamesA: 0, gamesB: 0, pointsA: 0, pointsB: 0 },
    complete: false,
    winner: null,
    history: []
  };
}

export function cloneScore(score) {
  return JSON.parse(JSON.stringify(score));
}

export function scoreFromHistory(history = [], format = SCORE_FORMAT) {
  const score = history.reduce((next, side) => applyPoint(next, side, false), createScore(format));
  // Preserve the canonical event log so the result is fully undoable and can
  // be persisted as the completed match snapshot.
  score.history = [...history];
  return score;
}

export function isTiebreak(score) {
  if (score.format.mode === 'quick-session') return false;
  const { gamesA, gamesB } = score.current;
  return gamesA === score.format.tiebreakAt && gamesB === score.format.tiebreakAt;
}

export function pointLabel(score, side) {
  const mine = side === 'a' ? score.current.pointsA : score.current.pointsB;
  const theirs = side === 'a' ? score.current.pointsB : score.current.pointsA;
  if (isTiebreak(score)) return String(mine);
  if (mine >= 3 && theirs >= 3) {
    if (mine === theirs) return '40';
    if (mine > theirs) return 'Ad';
    return '40';
  }
  return POINT_LABELS[Math.min(mine, 3)];
}

export function setDisplay(score, side) {
  if (score.format.mode === 'quick-session') return [];
  return score.sets.map((set) => {
    const games = side === 'a' ? set.a : set.b;
    const other = side === 'a' ? set.b : set.a;
    if (set.tiebreak) {
      const tiebreak = side === 'a' ? set.tiebreak.a : set.tiebreak.b;
      const opponent = side === 'a' ? set.tiebreak.b : set.tiebreak.a;
      return `${games}${games > other ? ` (${tiebreak})` : opponent > tiebreak ? ` (${tiebreak})` : ''}`;
    }
    return String(games);
  });
}

export function currentSetDisplay(score, side) {
  if (score.format.mode === 'quick-session') return matchSetsWon(score, side);
  return side === 'a' ? score.current.gamesA : score.current.gamesB;
}

export function matchSetsWon(score, side) {
  return score.sets.filter((set) => (side === 'a' ? set.a > set.b : set.b > set.a)).length;
}

export function scoreStatus(score) {
  if (score.complete) return `Match complete — Team ${score.winner.toUpperCase()} wins`;
  const { pointsA, pointsB } = score.current;
  if (isTiebreak(score)) return 'Tiebreak — first to 7, win by 2';
  if (pointsA >= 3 && pointsB >= 3) {
    if (pointsA === pointsB) return 'Deuce';
    return `Advantage Team ${pointsA > pointsB ? 'A' : 'B'}`;
  }

  const aPreview = applyPoint(score, 'a', false);
  const bPreview = applyPoint(score, 'b', false);
  const aWinsMatch = aPreview.complete && aPreview.winner === 'a';
  const bWinsMatch = bPreview.complete && bPreview.winner === 'b';
  if (aWinsMatch || bWinsMatch) return `${score.format.mode === 'quick-session' ? 'Game' : 'Match'} point — Team ${aWinsMatch ? 'A' : 'B'}`;
  const aWinsSet = aPreview.sets.length > score.sets.length;
  const bWinsSet = bPreview.sets.length > score.sets.length;
  if (aWinsSet || bWinsSet) return `Set point — Team ${aWinsSet ? 'A' : 'B'}`;
  return 'Standard advantage scoring';
}

export function applyPoint(input, side, recordHistory = true) {
  if (!['a', 'b'].includes(side)) throw new Error('A point must belong to team A or B.');
  const score = cloneScore(input);
  if (score.complete) return score;
  if (recordHistory) score.history.push(side);

  const own = side === 'a' ? 'pointsA' : 'pointsB';
  const other = side === 'a' ? 'pointsB' : 'pointsA';
  score.current[own] += 1;

  if (score.format.mode === 'quick-session') {
    if (score.current[own] >= 4 && score.current[own] - score.current[other] >= 2) {
      winQuickSet(score, side);
    }
    return score;
  }

  if (isTiebreak(score)) {
    if (score.current[own] >= score.format.tiebreakPoints
      && score.current[own] - score.current[other] >= 2) {
      winSet(score, side, true);
    }
    return score;
  }

  if (score.current[own] >= 4 && score.current[own] - score.current[other] >= 2) {
    winGame(score, side);
  }
  return score;
}

function winQuickSet(score, side) {
  score.sets.push({ a: side === 'a' ? 1 : 0, b: side === 'b' ? 1 : 0 });
  if (matchSetsWon(score, side) >= Math.ceil(score.format.bestOfSets / 2)) {
    score.complete = true;
    score.winner = side;
  }
  score.current = { gamesA: 0, gamesB: 0, pointsA: 0, pointsB: 0 };
}

export function undoPoint(score) {
  if (!score.history.length) return cloneScore(score);
  return scoreFromHistory(score.history.slice(0, -1), score.format);
}

function winGame(score, side) {
  const gameField = side === 'a' ? 'gamesA' : 'gamesB';
  score.current[gameField] += 1;
  score.current.pointsA = 0;
  score.current.pointsB = 0;

  const ownGames = score.current[gameField];
  const otherGames = score.current[side === 'a' ? 'gamesB' : 'gamesA'];
  if (ownGames >= score.format.gamesToWinSet && ownGames - otherGames >= 2) {
    winSet(score, side, false);
  }
}

function winSet(score, side, tiebreak) {
  const { gamesA, gamesB, pointsA, pointsB } = score.current;
  score.sets.push({
    // A tiebreak is played after 6–6 but the recorded set is 7–6.
    a: gamesA + (tiebreak && side === 'a' ? 1 : 0),
    b: gamesB + (tiebreak && side === 'b' ? 1 : 0),
    ...(tiebreak ? { tiebreak: { a: pointsA, b: pointsB } } : {})
  });
  const setsWon = matchSetsWon(score, side);
  if (setsWon >= Math.ceil(score.format.bestOfSets / 2)) {
    score.complete = true;
    score.winner = side;
  }
  score.current = { gamesA: 0, gamesB: 0, pointsA: 0, pointsB: 0 };
}

export function completedSetCount(score, side) {
  return score.sets.reduce((total, set) => total + (side === 'a' ? set.a : set.b), 0);
}
