const pairKey = (left, right) => [left, right].sort().join('::');

export { pairKey };

function shuffled(items, random = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/**
 * Finds a maximum-fairness matching of fresh teammate pairs. Players with the
 * lowest play count are considered first, so a 5/6/7-player session naturally
 * rotates the waiting player without asking an organiser to manage it.
 */
function opponentCost(teamA, teamB, opponentCounts) {
  return teamA.reduce((cost, playerA) => cost + teamB.reduce((inner, playerB) => inner + (opponentCounts[pairKey(playerA, playerB)] || 0), 0), 0);
}

function arrangeTeamsIntoMatches(teams, opponentCounts, random) {
  let best = null;
  let bestCost = Infinity;

  function search(remaining, matches, cost) {
    if (cost > bestCost) return;
    if (!remaining.length) {
      if (cost < bestCost || (cost === bestCost && random() > 0.5)) {
        best = matches.map(([teamA, teamB]) => ({ teamA, teamB }));
        bestCost = cost;
      }
      return;
    }
    const [first, ...others] = remaining;
    shuffled(others, random).sort((left, right) => opponentCost(first, left, opponentCounts) - opponentCost(first, right, opponentCounts))
      .forEach((second) => {
        const nextCost = cost + opponentCost(first, second, opponentCounts);
        search(others.filter((team) => team !== second), [...matches, [first, second]], nextCost);
      });
  }

  search(teams, [], 0);
  return best || [];
}

export function makeRound(playerIds, preferredCourts, pairCounts = {}, playCounts = {}, random = Math.random, opponentCounts = {}) {
  const activeCourts = Math.min(Math.max(1, Number(preferredCourts) || 1), Math.floor(playerIds.length / 4));
  const teamCount = activeCourts * 2;
  if (playerIds.length < 4 || teamCount < 2) return null;

  const used = new Set();
  const teams = [];
  let explored = 0;
  const limit = 45000;

  function partnersFor(playerId) {
    return shuffled(playerIds.filter((otherId) => otherId !== playerId
      && !used.has(otherId)
      && !pairCounts[pairKey(playerId, otherId)]), random)
      .sort((left, right) => (playCounts[left] || 0) - (playCounts[right] || 0));
  }

  function search(waiting) {
    explored += 1;
    if (explored > limit) return false;
    if (teams.length === teamCount) return true;
    const available = playerIds.filter((id) => !used.has(id));
    const teamsNeeded = teamCount - teams.length;
    if (available.length < teamsNeeded * 2) return false;

    const selectable = available
      .map((id) => ({ id, degree: partnersFor(id).length, played: playCounts[id] || 0 }))
      .sort((left, right) => left.played - right.played || left.degree - right.degree || random() - 0.5);
    const focus = selectable[0];
    if (!focus) return false;

    for (const partner of partnersFor(focus.id)) {
      used.add(focus.id);
      used.add(partner);
      teams.push([focus.id, partner]);
      if (search(waiting)) return true;
      teams.pop();
      used.delete(focus.id);
      used.delete(partner);
    }

    // We may leave someone out only when there are enough players for the
    // remaining courts. Trying this after pairing protects fair rotation.
    const playersThatCanWait = playerIds.length - teamCount * 2 - waiting.length;
    if (playersThatCanWait > 0) {
      used.add(focus.id);
      if (search([...waiting, focus.id])) return true;
      used.delete(focus.id);
    }
    return false;
  }

  if (!search([])) return null;

  const playing = new Set(teams.flat());
  const waiting = playerIds.filter((id) => !playing.has(id));
  const matches = [];
  const matchTeams = arrangeTeamsIntoMatches(teams, opponentCounts, random);
  matchTeams.forEach(({ teamA, teamB }, index) => {
    matches.push({
      id: `match-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      court: index + 1,
      teamA,
      teamB,
      waiting
    });
  });
  return { activeCourts, matches, waiting, teams };
}

export function roundCapacity(playerCount, preferredCourts) {
  const courts = Math.min(Math.max(1, Number(preferredCourts) || 1), Math.floor(playerCount / 4));
  return { courts, playing: courts * 4, waiting: Math.max(0, playerCount - courts * 4) };
}

export function recordRound(round, pairCounts = {}, playCounts = {}, opponentCounts = {}) {
  const nextPairs = { ...pairCounts };
  const nextPlays = { ...playCounts };
  const nextOpponents = { ...opponentCounts };
  round.matches.forEach((match) => {
    [match.teamA, match.teamB].forEach(([left, right]) => {
      const key = pairKey(left, right);
      nextPairs[key] = (nextPairs[key] || 0) + 1;
      nextPlays[left] = (nextPlays[left] || 0) + 1;
      nextPlays[right] = (nextPlays[right] || 0) + 1;
    });
    match.teamA.forEach((left) => match.teamB.forEach((right) => {
      const key = pairKey(left, right);
      nextOpponents[key] = (nextOpponents[key] || 0) + 1;
    }));
  });
  return { pairCounts: nextPairs, playCounts: nextPlays, opponentCounts: nextOpponents };
}

export function possibleFreshPairs(playerIds, pairCounts = {}) {
  let count = 0;
  for (let left = 0; left < playerIds.length; left += 1) {
    for (let right = left + 1; right < playerIds.length; right += 1) {
      if (!pairCounts[pairKey(playerIds[left], playerIds[right])]) count += 1;
    }
  }
  return count;
}
