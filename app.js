/* Padel Shuffle is intentionally dependency-free for reliable static hosting. */
(function () {
  'use strict';

  var STORAGE_KEY = 'padel-shuffle-session-v2';
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

  function teamOptions(group) {
    return [
      [[group[0], group[1]], [group[2], group[3]]],
      [[group[0], group[2]], [group[1], group[3]]],
      [[group[0], group[3]], [group[1], group[2]]]
    ];
  }

  function pairingPenalty(pairing) {
    return teammateCount(pairing[0][0], pairing[0][1]) + teammateCount(pairing[1][0], pairing[1][1]);
  }

  function findUniqueTeams(playerIds) {
    var teams = [];

    function matchRemaining(remaining) {
      if (!remaining.length) return true;
      var first = remaining[0];
      var partners = shuffle(remaining.slice(1).filter(function (candidate) {
        return teammateCount(first, candidate) === 0;
      }));
      for (var partnerIndex = 0; partnerIndex < partners.length; partnerIndex += 1) {
        var partner = partners[partnerIndex];
        var nextRemaining = remaining.filter(function (id) { return id !== first && id !== partner; });
        teams.push([first, partner]);
        if (matchRemaining(nextRemaining)) return true;
        teams.pop();
      }
      return false;
    }

    return matchRemaining(shuffle(playerIds)) ? shuffle(teams) : null;
  }

  function generateDoublesMatches(playerIds) {
    var teams = findUniqueTeams(playerIds);
    if (!teams) return null;
    return teams.map(function (team, index) {
      if (index % 2) return null;
      return { court: index / 2 + 1, teamA: team, teamB: teams[index + 1], waiting: [], score: emptyScore() };
    }).filter(Boolean);
  }

  function chooseRotationPlayers(playerIds) {
    var best = null;
    for (var first = 0; first < playerIds.length - 3; first += 1) {
      for (var second = first + 1; second < playerIds.length - 2; second += 1) {
        for (var third = second + 1; third < playerIds.length - 1; third += 1) {
          for (var fourth = third + 1; fourth < playerIds.length; fourth += 1) {
            var selected = [playerIds[first], playerIds[second], playerIds[third], playerIds[fourth]];
            var playTotal = selected.reduce(function (sum, id) { return sum + (state.playCounts[id] || 0); }, 0);
            var spread = selected.map(function (id) { return state.playCounts[id] || 0; });
            var fairnessPenalty = playTotal * 20 + (Math.max.apply(null, spread) - Math.min.apply(null, spread)) * 2;
            var options = teamOptions(selected).filter(function (option) { return pairingPenalty(option) === 0; });
            options.forEach(function (pairing) {
              if (!best || fairnessPenalty < best.penalty || (fairnessPenalty === best.penalty && Math.random() < 0.25)) {
                best = { penalty: fairnessPenalty, selected: selected, pairing: pairing };
              }
            });
          }
        }
      }
    }
    return best;
  }

  function generateRotationMatch() {
    var playerIds = state.players.map(function (player) { return player.id; });
    var choice = chooseRotationPlayers(playerIds);
    if (!choice) return null;
    choice.selected.forEach(function (id) {
      state.playCounts[id] = (state.playCounts[id] || 0) + 1;
    });
    return [{
      court: 1,
      teamA: choice.pairing[0],
      teamB: choice.pairing[1],
      waiting: playerIds.filter(function (id) { return choice.selected.indexOf(id) === -1; }),
      score: emptyScore()
    }];
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
    var matches = state.mode === 'rotation'
      ? generateRotationMatch()
      : generateDoublesMatches(playerIds);
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

  function renderSetup(message) {
    var existingNames = state && state.players ? state.players.map(function (player) { return player.name; }).join('\n') : '';
    app.innerHTML = '' +
      '<section class="topbar"><div><h1 class="brand">Padel Shuffle</h1><p class="round-label">Teams, score, repeat.</p></div></section>' +
      '<section class="card setup-card">' +
        '<h2 class="section-title">Set up your session</h2>' +
        '<p class="helper">Enter one player per line. Your session stays on this device.</p>' +
        (message ? '<p class="notice">' + escapeHtml(message) + '</p>' : '') +
        '<form id="setup-form">' +
          '<label for="player-names">Player names</label>' +
          '<textarea id="player-names" required placeholder="Enter Player Name Here">' + escapeHtml(existingNames) + '</textarea>' +
          '<div class="field-row">' +
            '<div><label for="court-count">Courts</label><select id="court-count"><option value="1">1 court</option><option value="2">2 courts</option><option value="3">3 courts</option><option value="4">4 courts</option></select></div>' +
            '<div><label for="game-mode">Game mode</label><select id="game-mode"><option value="doubles">4 per court</option><option value="rotation">8-player rotation</option></select></div>' +
          '</div>' +
          '<p class="helper" id="mode-help">Doubles needs exactly 4 players for each court.</p>' +
          '<button class="button button--full" type="submit">🔀 Start &amp; Shuffle</button>' +
        '</form>' +
      '</section>';
    var form = document.getElementById('setup-form');
    var mode = document.getElementById('game-mode');
    var courts = document.getElementById('court-count');
    if (state) {
      courts.value = String(state.courts || 1);
      mode.value = state.mode || 'doubles';
    }
    function updateModeHelp() {
      var help = document.getElementById('mode-help');
      if (mode.value === 'rotation') {
        courts.value = '1';
        courts.disabled = true;
        help.textContent = 'Rotation mode uses exactly 8 players on 1 court: 4 play and 4 wait.';
      } else {
        courts.disabled = false;
        help.textContent = 'Doubles needs exactly 4 players for each court.';
      }
    }
    mode.addEventListener('change', updateModeHelp);
    updateModeHelp();
    form.addEventListener('submit', startSession);
  }

  function renderMatch(match) {
    var score = match.score;
    var isTie = score.pointsA === 3 && score.pointsB === 3;
    var winnerText = score.complete ? '🏆 TEAM ' + (score.winner === 'a' ? 'A' : 'B') + ' WINS' : '';
    var waiting = match.waiting.length
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
        '<section class="topbar"><div><h1 class="brand">Padel Shuffle</h1><p class="round-label">Session complete</p></div><button class="button button--quiet" data-action="end">End session</button></section>' +
        '<section class="card"><h2 class="section-title">All unique teammate pairs have played</h2><p class="helper">No teammate pair will repeat. Start a new session when you are ready to play together again.</p></section>' +
        '<section class="card leaderboard-card"><h2>Leaderboard</h2><div class="table-wrap"><table><thead><tr><th>Player</th><th>Games</th><th>Wins</th><th>Losses</th><th>Sets</th></tr></thead><tbody>' + leaderboardRows() + '</tbody></table></div></section>';
      return;
    }
    var allComplete = state.matches.every(matchIsComplete);
    app.innerHTML = '' +
      '<section class="topbar"><div><h1 class="brand">Padel Shuffle</h1><p class="round-label">Round ' + state.round + ' · ' + (state.mode === 'rotation' ? '8-player rotation' : state.courts + ' court' + (state.courts > 1 ? 's' : '')) + '</p></div><button class="button button--quiet" data-action="end">End session</button></section>' +
      (message ? '<p class="notice">' + escapeHtml(message) + '</p>' : '') +
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
    var mode = document.getElementById('game-mode').value;
    var lowerNames = rawNames.map(function (name) { return name.toLocaleLowerCase(); });
    if (new Set(lowerNames).size !== rawNames.length) {
      renderSetup('Please use a unique name for each player.');
      return;
    }
    if (mode === 'rotation' && (courts !== 1 || rawNames.length !== 8)) {
      renderSetup('8-player rotation needs exactly 8 players and 1 court.');
      return;
    }
    if (mode === 'doubles' && rawNames.length !== courts * 4) {
      renderSetup('Doubles needs exactly ' + (courts * 4) + ' players for ' + courts + ' court' + (courts > 1 ? 's' : '') + '.');
      return;
    }
    state = {
      version: 1,
      players: rawNames.map(function (name, index) { return { id: uid(index), name: name }; }),
      courts: courts,
      mode: mode,
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
