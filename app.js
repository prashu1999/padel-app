/* Padelé is intentionally dependency-free for reliable static hosting. */
(function () {
  'use strict';

  var STORAGE_KEY = 'padele-session-v1';
  var app = document.getElementById('app');
  var state = loadState();

  function uid(index) {
    return 'player-' + index + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function emptyScore() {
    return {
      setsA: 0,
      setsB: 0,
      pointsA: 0,
      pointsB: 0,
      advantage: null,
      complete: false,
      winner: null,
      undo: []
    };
  }

  function loadState() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return null;
      var parsed = JSON.parse(saved);
      if (!parsed || !parsed.players || !parsed.matches) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function saveState() {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function playerById(id) {
    return state.players.filter(function (player) { return player.id === id; })[0];
  }

  function playerName(id) {
    var player = playerById(id);
    return player ? player.name : 'Unknown player';
  }

  function pairKey(idA, idB) {
    return [idA, idB].sort().join('::');
  }

  function teammateCount(idA, idB) {
    return state.teammates[pairKey(idA, idB)] || 0;
  }

  function shuffle(items) {
    var copy = items.slice();
    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  function findAdaptiveUniqueTeams(playerIds, teamCount) {
    var solution = null;

    function search(available, teams) {
      if (teams.length === teamCount) {
        solution = teams.slice();
        return true;
      }
      if (available.length < (teamCount - teams.length) * 2) return false;
      var options = [];
      for (var first = 0; first < available.length - 1; first += 1) {
        for (var second = first + 1; second < available.length; second += 1) {
          if (teammateCount(available[first], available[second]) === 0) {
            options.push({
              team: [available[first], available[second]],
              score: (state.playCounts[available[first]] || 0) + (state.playCounts[available[second]] || 0) + Math.random() * .35
            });
          }
        }
      }
      options.sort(function (left, right) { return left.score - right.score; });
      for (var optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
        var team = options[optionIndex].team;
        var remaining = available.filter(function (id) { return id !== team[0] && id !== team[1]; });
        teams.push(team);
        if (search(remaining, teams)) return true;
        teams.pop();
      }
      return false;
    }

    return search(shuffle(playerIds), []) ? solution : null;
  }

  function generateAdaptiveMatches(playerIds, courtCount) {
    var teams = findAdaptiveUniqueTeams(playerIds, courtCount * 2);
    if (!teams) return null;
    var playing = teams.reduce(function (ids, team) { return ids.concat(team); }, []);
    var waiting = playerIds.filter(function (id) { return playing.indexOf(id) === -1; });
    playing.forEach(function (id) {
      state.playCounts[id] = (state.playCounts[id] || 0) + 1;
    });
    return teams.map(function (team, index) {
      if (index % 2) return null;
      return { court: index / 2 + 1, teamA: team, teamB: teams[index + 1], waiting: waiting, score: emptyScore() };
    }).filter(Boolean);
  }

  function recordTeamHistory(matches) {
    matches.forEach(function (match) {
      [match.teamA, match.teamB].forEach(function (team) {
        var key = pairKey(team[0], team[1]);
        state.teammates[key] = (state.teammates[key] || 0) + 1;
      });
    });
  }

  function createRound() {
    var playerIds = state.players.map(function (player) { return player.id; });
    var matches = generateAdaptiveMatches(playerIds, state.courts);
    if (!matches) {
      state.matches = [];
      state.finishedNoPairs = true;
      return false;
    }
    state.matches = matches;
    state.finishedNoPairs = false;
    recordTeamHistory(state.matches);
    return true;
  }

  function getPointLabel(score, side) {
    if (score.pointsA === 3 && score.pointsB === 3) {
      if (score.advantage === side) return 'Ad';
      return '40';
    }
    return ['0', '15', '30', '40'][score[side === 'a' ? 'pointsA' : 'pointsB']];
  }

  function getScoreStatus(score) {
    if (score.complete) return 'Match complete';
    if (score.pointsA === 3 && score.pointsB === 3) {
      if (score.advantage === 'a') return 'Advantage Team A';
      if (score.advantage === 'b') return 'Advantage Team B';
      return 'Deuce';
    }
    return '';
  }

  function snapshotScore(score) {
    var snapshot = clone(score);
    snapshot.undo = [];
    score.undo.push(snapshot);
    if (score.undo.length > 100) score.undo.shift();
  }

  function resetPoints(score) {
    score.pointsA = 0;
    score.pointsB = 0;
    score.advantage = null;
  }

  function awardSet(score, winner) {
    if (winner === 'a') score.setsA += 1;
    else score.setsB += 1;
    resetPoints(score);
    // One recorded game is won by the first team to win two sets.
    // At 1–1, the next set is therefore the deciding set.
    if (score.setsA === 2 || score.setsB === 2) {
      score.complete = true;
      score.winner = score.setsA === 2 ? 'a' : 'b';
    }
  }

  function addPoint(match, side) {
    var score = match.score;
    if (score.complete) return;
    snapshotScore(score);
    var ownPoints = side === 'a' ? score.pointsA : score.pointsB;
    var otherPoints = side === 'a' ? score.pointsB : score.pointsA;
    if (ownPoints < 3) {
      if (side === 'a') score.pointsA += 1;
      else score.pointsB += 1;
    } else if (otherPoints < 3) {
      awardSet(score, side);
    } else if (score.advantage === side) {
      awardSet(score, side);
    } else if (score.advantage) {
      score.advantage = null;
    } else {
      score.advantage = side;
    }
  }

  function undoScore(match) {
    var score = match.score;
    if (!score.undo.length) return;
    var previous = score.undo.pop();
    previous.undo = score.undo;
    match.score = previous;
  }

  function matchIsComplete(match) {
    return match.score.complete;
  }

  function updateStatistics() {
    state.matches.forEach(function (match) {
      var score = match.score;
      if (!score.complete) return;
      var winnerTeam = score.winner === 'a' ? match.teamA : match.teamB;
      var loserTeam = score.winner === 'a' ? match.teamB : match.teamA;
      winnerTeam.forEach(function (id) {
        state.stats[id].games += 1;
        state.stats[id].wins += 1;
        state.stats[id].sets += score.setsA > score.setsB ? score.setsA : score.setsB;
      });
      loserTeam.forEach(function (id) {
        state.stats[id].games += 1;
        state.stats[id].losses += 1;
        state.stats[id].sets += score.setsA > score.setsB ? score.setsB : score.setsA;
      });
      state.history.push({
        round: state.round,
        court: match.court,
        winner: winnerTeam.slice(),
        loser: loserTeam.slice(),
        score: score.setsA + '–' + score.setsB,
        savedAt: new Date().toISOString()
      });
    });
  }

  function sessionPlan(playerCount, courts) {
    if (!playerCount) return { heading: 'Build your game plan', detail: 'Add up to 20 players to see your unique-team schedule.' };
    if (playerCount > 20) return { heading: '20-player limit', detail: 'Remove ' + (playerCount - 20) + ' player' + (playerCount - 20 === 1 ? '' : 's') + ' to continue.' };
    if (playerCount < 4) return { heading: '4 players needed', detail: 'Add ' + (4 - playerCount) + ' more player' + (playerCount === 3 ? '' : 's') + ' to start.' };
    var activePlayers = courts * 4;
    var waitingPlayers = playerCount - activePlayers;
    var rounds = Math.floor((playerCount * (playerCount - 1)) / (4 * courts));
    var courtGames = rounds * courts;
    return {
      heading: rounds + ' unique shuffle round' + (rounds === 1 ? '' : 's') + ' available',
      detail: courtGames + ' court game' + (courtGames === 1 ? '' : 's') + ' before a teammate would repeat. ' + activePlayers + ' play' + (waitingPlayers ? ', ' + waitingPlayers + ' wait' : '') + ' each round.'
    };
  }

  function renderCourtAssignments() {
    var assignments = state.matches.map(function (match) {
      var playing = match.teamA.concat(match.teamB).map(playerName).map(escapeHtml).join(' · ');
      return '<div class="assignment"><span class="assignment-court">COURT ' + match.court + '</span><span class="assignment-players">' + playing + '</span></div>';
    }).join('');
    var waiting = state.matches[0].waiting;
    var waitingPanel = waiting.length ? '<div class="assignment-waiting"><strong>WAITING THIS ROUND</strong><span>' + waiting.map(playerName).map(escapeHtml).join(' · ') + '</span></div>' : '';
    return '<section class="assignments-card"><div class="assignments-heading"><div><span class="eyebrow">WHO PLAYS WHERE</span><h2>Tonight’s courts</h2></div><span class="assignment-count">' + state.matches.length + ' active</span></div><div class="assignments-grid">' + assignments + '</div>' + waitingPanel + '</section>';
  }

  function renderSetup(message) {
    var existingNames = state && state.players ? state.players.map(function (player) { return player.name; }).join('\n') : '';
    app.innerHTML = '' +
      '<section class="topbar topbar--setup"><div><h1 class="brand">Padelé</h1><p class="round-label">Your court, shuffled fairly.</p></div></section>' +
      '<section class="card setup-card">' +
        '<span class="eyebrow">SESSION SETUP</span><h2 class="section-title">Ready for the court?</h2>' +
        '<p class="helper">Add 4 to 20 players. Padelé assigns courts automatically and rotates anyone waiting into the next shuffle.</p>' +
        (message ? '<p class="notice">' + escapeHtml(message) + '</p>' : '') +
        '<form id="setup-form">' +
          '<label class="player-label" for="player-names"><span>Player names</span><span id="player-count" class="player-count">0 / 20</span></label>' +
          '<textarea id="player-names" required placeholder="Enter Player Names Here">' + escapeHtml(existingNames) + '</textarea>' +
          '<div class="field-row">' +
            '<div><label for="court-count">Courts</label><select id="court-count"><option value="1">1 court</option><option value="2">2 courts</option><option value="3">3 courts</option><option value="4">4 courts</option><option value="5">5 courts</option></select></div>' +
            '<div class="auto-format"><span>FORMAT</span><strong>Auto shuffle</strong><small>4 players per court</small></div>' +
          '</div>' +
          '<p class="helper" id="mode-help">Add at least 4 players to start.</p>' +
          '<section class="session-plan" aria-live="polite"><span class="plan-icon">⌁</span><div><strong id="plan-heading">Build your game plan</strong><span id="plan-detail">Add up to 20 players to see your unique-team schedule.</span></div></section>' +
          '<button class="button button--full" type="submit">🔀 Start &amp; Shuffle</button>' +
        '</form>' +
      '</section>';
    var form = document.getElementById('setup-form');
    var courts = document.getElementById('court-count');
    var playerNames = document.getElementById('player-names');
    if (state) {
      courts.value = String(state.courts || 1);
    }
    function updateSetupSummary() {
      var help = document.getElementById('mode-help');
      var playerCount = playerNames.value.split(/\r?\n/).map(function (name) { return name.trim(); }).filter(Boolean).length;
      var maxCourts = Math.min(5, Math.floor(playerCount / 4));
      for (var optionIndex = 0; optionIndex < courts.options.length; optionIndex += 1) {
        courts.options[optionIndex].disabled = playerCount >= 4 && Number(courts.options[optionIndex].value) > maxCourts;
      }
      if (playerCount >= 4 && Number(courts.value) > maxCourts) courts.value = String(maxCourts);
      var activePlayers = Math.min(playerCount, Number(courts.value) * 4);
      var waitingPlayers = Math.max(0, playerCount - activePlayers);
      help.textContent = playerCount < 4
        ? 'Add at least ' + (4 - playerCount) + ' more player' + (playerCount === 3 ? '' : 's') + ' to start.'
        : activePlayers + ' will play this round' + (waitingPlayers ? '; ' + waitingPlayers + ' will wait and rotate in next game.' : '.');
      var plan = sessionPlan(playerCount, Number(courts.value));
      var countLabel = document.getElementById('player-count');
      countLabel.textContent = playerCount + ' / 20';
      countLabel.classList.toggle('player-count--limit', playerCount > 20);
      document.getElementById('plan-heading').textContent = plan.heading;
      document.getElementById('plan-detail').textContent = plan.detail;
    }
    courts.addEventListener('change', updateSetupSummary);
    playerNames.addEventListener('input', updateSetupSummary);
    updateSetupSummary();
    form.addEventListener('submit', startSession);
  }

  function renderMatch(match) {
    var score = match.score;
    var isTie = score.pointsA === 3 && score.pointsB === 3;
    var winnerText = score.complete ? '🏆 TEAM ' + (score.winner === 'a' ? 'A' : 'B') + ' WINS' : '';
    var waiting = match.court === 1 && match.waiting.length
      ? '<div class="waiting"><span class="waiting-title">WAITING</span><ul class="waiting-list">' + match.waiting.map(function (id) { return '<li>' + escapeHtml(playerName(id)) + '</li>'; }).join('') + '</ul></div>'
      : '';
    return '<article class="card court-card" data-court="' + match.court + '">' +
      '<div class="court-heading"><h2>COURT ' + match.court + '</h2>' + (score.complete ? '<span class="match-complete">Finished</span>' : '') + '</div>' +
      (winnerText ? '<p class="match-winner">' + winnerText + '</p>' : '') +
      '<div class="teams"><div class="team"><span class="team-name">TEAM A</span><span class="players">' + escapeHtml(playerName(match.teamA[0])) + ' + ' + escapeHtml(playerName(match.teamA[1])) + '</span></div><span class="vs">VS</span><div class="team"><span class="team-name">TEAM B</span><span class="players">' + escapeHtml(playerName(match.teamB[0])) + ' + ' + escapeHtml(playerName(match.teamB[1])) + '</span></div></div>' +
      '<div class="scoreboard"><div class="score-cell"><span>TEAM A</span><strong class="point-score">' + getPointLabel(score, 'a') + '</strong></div><div class="score-cell"><span>TEAM B</span><strong class="point-score">' + getPointLabel(score, 'b') + '</strong></div></div>' +
      '<p class="score-status' + (isTie ? ' score-status--tie' : '') + '">' + getScoreStatus(score) + '</p>' +
      '<div class="stat-row"><div class="stat">Sets: <strong>' + score.setsA + ' – ' + score.setsB + '</strong></div><div class="stat">Game: <strong>' + (score.complete ? 'Complete' : 'In progress') + '</strong></div></div>' +
      '<div class="point-buttons"><button class="button point-button" data-action="point" data-side="a" data-court="' + match.court + '" ' + (score.complete ? 'disabled' : '') + '>A +1</button><button class="button point-button" data-action="point" data-side="b" data-court="' + match.court + '" ' + (score.complete ? 'disabled' : '') + '>B +1</button></div>' +
      '<div class="court-actions"><button class="button button--quiet" data-action="undo" data-court="' + match.court + '" ' + (score.undo.length ? '' : 'disabled') + '>Undo</button><button class="button button--quiet button--danger" data-action="reset" data-court="' + match.court + '">Reset</button></div>' +
      waiting +
    '</article>';
  }

  function leaderboardRows() {
    return state.players.slice().sort(function (left, right) {
      var leftStats = state.stats[left.id];
      var rightStats = state.stats[right.id];
      return rightStats.wins - leftStats.wins || rightStats.sets - leftStats.sets || left.name.localeCompare(right.name);
    }).map(function (player) {
      var stats = state.stats[player.id];
      return '<tr><td>' + escapeHtml(player.name) + '</td><td>' + stats.games + '</td><td>' + stats.wins + '</td><td>' + stats.losses + '</td><td>' + stats.sets + '</td></tr>';
    }).join('');
  }

  function renderSession(message) {
    if (state.finishedNoPairs) {
      app.innerHTML = '' +
        '<section class="topbar"><div><h1 class="brand">Padelé</h1><p class="round-label">Session complete</p></div><button class="button button--quiet" data-action="end">End session</button></section>' +
        '<section class="card"><h2 class="section-title">All unique teammate pairs have played</h2><p class="helper">No teammate pair will repeat. Start a new session when you are ready to play together again.</p></section>' +
        '<section class="card leaderboard-card"><h2>Leaderboard</h2><div class="table-wrap"><table><thead><tr><th>Player</th><th>Games</th><th>Wins</th><th>Losses</th><th>Sets</th></tr></thead><tbody>' + leaderboardRows() + '</tbody></table></div></section>';
      return;
    }
    var allComplete = state.matches.every(matchIsComplete);
    app.innerHTML = '' +
      '<section class="topbar"><div><h1 class="brand">Padelé</h1><p class="round-label">Round ' + state.round + ' · ' + state.courts + ' court' + (state.courts > 1 ? 's' : '') + ' · ' + state.players.length + ' players</p></div><button class="button button--quiet" data-action="end">End session</button></section>' +
      (message ? '<p class="notice">' + escapeHtml(message) + '</p>' : '') +
      renderCourtAssignments() +
      '<section class="matches">' + state.matches.map(renderMatch).join('') + '</section>' +
      '<button class="button button--full button--next" data-action="next" ' + (allComplete ? '' : 'disabled') + '>➜ NEXT GAME</button>' +
      (!allComplete ? '<p class="helper">Finish every court (first to 2 sets) to start the next game.</p>' : '<p class="helper">Results will be saved to the leaderboard and the next round will be shuffled.</p>') +
      '<section class="card leaderboard-card"><h2>Leaderboard</h2><div class="table-wrap"><table><thead><tr><th>Player</th><th>Games</th><th>Wins</th><th>Losses</th><th>Sets</th></tr></thead><tbody>' + leaderboardRows() + '</tbody></table></div></section>';
  }

  function render(message) {
    if (state) renderSession(message);
    else renderSetup(message);
  }

  function startSession(event) {
    event.preventDefault();
    var rawNames = document.getElementById('player-names').value.split(/\r?\n/).map(function (name) { return name.trim(); }).filter(Boolean);
    var courts = Number(document.getElementById('court-count').value);
    var lowerNames = rawNames.map(function (name) { return name.toLocaleLowerCase(); });
    if (new Set(lowerNames).size !== rawNames.length) {
      renderSetup('Please use a unique name for each player.');
      return;
    }
    if (rawNames.length > 20) {
      renderSetup('A session can have up to 20 players.');
      return;
    }
    if (rawNames.length < 4) {
      renderSetup('At least 4 players are needed to start a game.');
      return;
    }
    if (rawNames.length < courts * 4) {
      renderSetup(courts + ' court' + (courts > 1 ? 's' : '') + ' need' + (courts === 1 ? 's' : '') + ' at least ' + (courts * 4) + ' players.');
      return;
    }
    state = {
      version: 1,
      players: rawNames.map(function (name, index) { return { id: uid(index), name: name }; }),
      courts: courts,
      round: 1,
      teammates: {},
      playCounts: {},
      stats: {},
      history: [],
      matches: []
    };
    state.players.forEach(function (player) {
      state.playCounts[player.id] = 0;
      state.stats[player.id] = { games: 0, wins: 0, losses: 0, sets: 0 };
    });
    createRound();
    saveState();
    render();
  }

  function getMatch(court) {
    return state.matches.filter(function (match) { return match.court === Number(court); })[0];
  }

  app.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button || button.disabled || !state) return;
    var action = button.dataset.action;
    var match;
    if (action === 'point') {
      match = getMatch(button.dataset.court);
      addPoint(match, button.dataset.side);
      saveState();
      render();
    } else if (action === 'undo') {
      undoScore(getMatch(button.dataset.court));
      saveState();
      render();
    } else if (action === 'reset') {
      match = getMatch(button.dataset.court);
      if (window.confirm('Reset the score for Court ' + match.court + '?')) {
        match.score = emptyScore();
        saveState();
        render();
      }
    } else if (action === 'next') {
      if (!state.matches.every(matchIsComplete)) return;
      updateStatistics();
      state.round += 1;
      var hasNextRound = createRound();
      saveState();
      render(hasNextRound ? 'Round ' + state.round + ' is ready.' : 'All unique teammate pairs have now played.');
    } else if (action === 'end') {
      if (window.confirm('End this session and clear its scores and leaderboard from this device?')) {
        localStorage.removeItem(STORAGE_KEY);
        state = null;
        renderSetup('Session ended.');
      }
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./service-worker.js').catch(function () {
        // The app remains usable when a host does not support service workers.
      });
    });
  }

  /* Minimal hook for automated smoke tests; no data is sent anywhere. */
  window.PadelShuffleTest = {
    emptyScore: emptyScore,
    addPoint: function (score, side) { addPoint({ score: score }, side); return score; },
    awardSet: awardSet,
    getPointLabel: getPointLabel
  };

  render();
}());
