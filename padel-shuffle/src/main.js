import './styles.css';
import {
  applyPoint, createScore, currentSetDisplay, matchSetsWon, pointLabel,
  QUICK_SESSION_FORMAT, scoreFromHistory, scoreStatus, setDisplay, undoPoint
} from './scoring.js';
import { makeRound, pairKey, possibleFreshPairs, recordRound, roundCapacity } from './shuffle.js';
import {
  clearOfflineSession, loadOfflineSession, newOfflineSession, playerStats, saveOfflineSession
} from './offline-store.js';
import { announce, voiceAvailable } from './voice.js';
import { cloudConfigured, supabase } from './lib/supabase.js';
import { getCurrentUser, getProfile, resetPasswordForEmail, signIn, signOut, signUp } from './services/auth.js';
import { friendlyServiceError } from './services/query.js';
import {
  addGuestPlayer, createTournament, deleteTournament, joinTournament, listMyTournaments, loadTournament,
  loadPairingHistory, recordPoint, startRound
} from './services/tournaments.js';
import { subscribeToTournament } from './services/realtime.js';

const app = document.querySelector('#app');
let unsubscribeTournament = null;
let dashboardExpiryTimer = null;

const state = {
  route: 'home',
  offline: loadOfflineSession(),
  draft: { names: '', courts: 1, voice: true },
  notice: null,
  online: {
    loading: false,
    user: null,
    profile: null,
    authMode: 'sign-in',
    tournaments: [],
    selected: null
  }
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function playerName(session, id) {
  return session.players.find((player) => player.id === id)?.name || 'Guest';
}

function namesFromInput(value) {
  return value.split(/[\n,]/).map((name) => name.trim()).filter(Boolean);
}

function setNotice(message, kind = 'info') {
  state.notice = message ? { message, kind } : null;
}

function formatDateTime(value) {
  if (!value) return 'Time not set';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function isHiddenFromHostDashboard(tournament) {
  return Boolean(tournament.ends_at && Date.now() >= new Date(tournament.ends_at).getTime() + (2 * 60 * 60 * 1000));
}

function scheduleDashboardExpiry() {
  window.clearTimeout(dashboardExpiryTimer);
  const now = Date.now();
  const nextExpiry = state.online.tournaments
    .filter((tournament) => tournament.organizer_id === state.online.user?.id && tournament.ends_at)
    .map((tournament) => new Date(tournament.ends_at).getTime() + (2 * 60 * 60 * 1000))
    .filter((time) => Number.isFinite(time) && time > now)
    .sort((left, right) => left - right)[0];
  // Browsers cap a single timer at roughly 24 days. A later dashboard render
  // reschedules distant events, while near expiries disappear without a reload.
  if (nextExpiry && nextExpiry - now <= 2_147_000_000) {
    dashboardExpiryTimer = window.setTimeout(() => render(), nextExpiry - now + 50);
  }
}

function saveOffline() {
  if (state.offline) saveOfflineSession(state.offline);
}

function replaceOffline(next) {
  state.offline = next;
  saveOffline();
}

function banner() {
  if (!state.notice) return '';
  return `<div class="notice notice--${state.notice.kind}" role="status">
    <span>${escapeHtml(state.notice.message)}</span><button class="icon-button" data-action="dismiss-notice" aria-label="Dismiss">×</button>
  </div>`;
}

function header(label = '') {
  return `<header class="topbar">
    <button class="brand" data-action="go-home" aria-label="Padelé home">Padelé</button>
    <div class="topbar__right">
      ${label ? `<span class="round-label">${escapeHtml(label)}</span>` : ''}
      <button class="nav-pill" data-action="go-home">Home</button>
    </div>
  </header>`;
}

function renderHome() {
  const canResume = state.offline && !state.offline.completed;
  return `${header()}
    <section class="hero">
      <p class="eyebrow eyebrow--light">SOCIAL PADEL, MADE SIMPLE</p>
      <h1>Get on court.<br><em>Keep it moving.</em></h1>
      <p class="hero__copy">Fair teams, real padel scoring, and a live tournament room — designed around the next point.</p>
      <div class="mode-grid">
        <button class="mode-card mode-card--offline" data-action="offline-setup">
          <span class="mode-card__icon">⌁</span><span class="mode-card__meta">NO ACCOUNT NEEDED</span>
          <strong>Play offline</strong><small>Shuffle locally, score and rotate.</small><span class="mode-card__arrow">→</span>
        </button>
        <button class="mode-card mode-card--online" data-action="online-home">
          <span class="mode-card__icon">◎</span><span class="mode-card__meta">PLAY TOGETHER</span>
          <strong>Play online</strong><small>Live rooms and shared scoreboards.</small><span class="mode-card__arrow">→</span>
        </button>
      </div>
      ${canResume ? `<button class="resume-card" data-action="resume-offline"><span>Resume local session</span><strong>Round ${state.offline.roundNumber || 1} →</strong></button>` : ''}
    </section>
    <section class="feature-strip" aria-label="Padelé features">
      <span>4–20 players</span><span>1–5 courts</span><span>No repeat teammates</span>
    </section>`;
}

function setupEstimate(count, courts) {
  if (!count) return 'Add names to see your court plan.';
  if (count < 4) return `Add ${4 - count} more player${count === 3 ? '' : 's'} to start.`;
  if (count > 20) return `Remove ${count - 20} name${count === 21 ? '' : 's'} — 20 is the maximum.`;
  const capacity = roundCapacity(count, courts);
  const pairs = (count * (count - 1)) / 2;
  const maximumRounds = Math.floor(pairs / (capacity.courts * 2));
  return `${capacity.playing} play on ${capacity.courts} court${capacity.courts === 1 ? '' : 's'}${capacity.waiting ? ` · ${capacity.waiting} rotate out` : ''}. Up to ${maximumRounds} fresh-pair rotations.`;
}

function renderOfflineSetup() {
  const count = namesFromInput(state.draft.names).length;
  const capacity = count >= 4 && count <= 20 ? roundCapacity(count, state.draft.courts) : null;
  return `${header('OFFLINE SESSION')}${banner()}
    <section class="setup-card card">
      <p class="eyebrow">OFFLINE MODE</p>
      <h1 class="page-title">Make the next<br><em>four feel fair.</em></h1>
      <p class="helper">Nothing leaves this device. Padelé automatically stops when a teammate pairing would have to repeat.</p>
      <form data-form="offline-start">
        <label class="label-row" for="offline-names"><span>Players</span><b id="player-count" class="player-count ${count > 20 ? 'player-count--limit' : ''}">${count}/20</b></label>
        <textarea id="offline-names" data-draft="names" placeholder="Enter Player Names Here" autocomplete="off">${escapeHtml(state.draft.names)}</textarea>
        <div class="field-grid">
          <label for="offline-courts">Courts
            <select id="offline-courts" data-draft="courts">
              ${[1, 2, 3, 4, 5].map((court) => `<option value="${court}" ${Number(state.draft.courts) === court ? 'selected' : ''}>${court} court${court === 1 ? '' : 's'}</option>`).join('')}
            </select>
          </label>
          <label class="voice-toggle" for="offline-voice"><span>Voice calls</span><input id="offline-voice" data-draft="voice" type="checkbox" ${state.draft.voice ? 'checked' : ''} ${voiceAvailable() ? '' : 'disabled'} /><i></i><small>${voiceAvailable() ? 'Point & winner calls' : 'Not available here'}</small></label>
        </div>
        <div id="plan-card" class="plan-card ${capacity ? '' : 'plan-card--muted'}"><span class="plan-icon">⌁</span><p><strong id="plan-heading">${capacity ? `${capacity.courts} court${capacity.courts === 1 ? '' : 's'} ready` : 'Your court plan'}</strong><span id="plan-detail">${setupEstimate(count, Number(state.draft.courts))}</span></p></div>
        <button id="start-shuffle" class="button button--primary button--large" type="submit" ${count < 4 || count > 20 ? 'disabled' : ''}>Start the shuffle <span>→</span></button>
      </form>
      <button class="text-button" data-action="go-home">Back to home</button>
    </section>`;
}

function teamNames(session, ids) {
  return ids.map((id) => escapeHtml(playerName(session, id))).join('<br>');
}

function scoreSets(score, side) {
  if (score.format.mode === 'quick-session') {
    return `<span class="sets-line"><b title="Next set">SET ${score.sets.length + 1}</b></span>`;
  }
  const completed = setDisplay(score, side);
  const current = currentSetDisplay(score, side);
  return `<span class="sets-line">${completed.length ? completed.map((value, index) => `<b title="Set ${index + 1}">${value}</b>`).join('') : '<b>–</b>'}<b class="sets-line__current" title="Current set">${current}</b></span>`;
}

function renderMatchCard(match, session) {
  const score = match.score;
  const aWon = matchSetsWon(score, 'a');
  const bWon = matchSetsWon(score, 'b');
  const complete = score.complete;
  return `<article class="match-card ${complete ? 'match-card--complete' : ''}">
    <div class="match-card__header"><span>COURT ${match.court}</span><span>${complete ? 'FINAL' : `BEST OF ${score.format.bestOfSets}`}</span></div>
    <div class="match-teams">
      <section class="team team--a"><span>TEAM A</span><strong>${teamNames(session, match.teamA)}</strong></section>
      <div class="versus">VS</div>
      <section class="team team--b"><span>TEAM B</span><strong>${teamNames(session, match.teamB)}</strong></section>
    </div>
    <div class="match-score" aria-label="Match score">
      <div><span>SETS</span><strong>${aWon}</strong>${scoreSets(score, 'a')}</div>
      <div><span>SETS</span><strong>${bWon}</strong>${scoreSets(score, 'b')}</div>
    </div>
    <div class="point-board">
      <button class="score-button score-button--a" data-action="offline-point" data-match="${match.id}" data-side="a" ${complete ? 'disabled' : ''}><span>TEAM A</span><b>${pointLabel(score, 'a')}</b><small>+ point</small></button>
      <p class="score-status ${complete ? 'score-status--complete' : ''}">${escapeHtml(scoreStatus(score))}</p>
      <button class="score-button score-button--b" data-action="offline-point" data-match="${match.id}" data-side="b" ${complete ? 'disabled' : ''}><span>TEAM B</span><b>${pointLabel(score, 'b')}</b><small>+ point</small></button>
    </div>
    <div class="match-card__footer"><span>${score.format.mode === 'quick-session' ? 'Sets won' : 'Games'}: ${currentSetDisplay(score, 'a')} – ${currentSetDisplay(score, 'b')}</span><button class="text-button text-button--compact" data-action="offline-undo" data-match="${match.id}" ${score.history.length ? '' : 'disabled'}>Undo last point</button></div>
  </article>`;
}

function renderLeaderboard(session) {
  const stats = playerStats(session);
  if (!session.history.length) return '';
  return `<section class="leaderboard card"><div class="section-heading"><p class="eyebrow">SESSION FORM</p><h2>Leaderboard</h2></div>
    <div class="table-wrap"><table><thead><tr><th>Player</th><th>W</th><th>L</th><th>Sets</th><th>Games</th></tr></thead><tbody>
    ${stats.map((stat) => `<tr><td>${escapeHtml(stat.name)}</td><td>${stat.wins}</td><td>${stat.losses}</td><td>${stat.sets}</td><td>${stat.games}</td></tr>`).join('')}
    </tbody></table></div></section>`;
}

function renderOfflineSession() {
  const session = state.offline;
  if (!session) return renderOfflineSetup();
  const allComplete = session.matches.length > 0 && session.matches.every((match) => match.score.complete);
  const waitingNames = session.matches[0]?.waiting.map((id) => playerName(session, id)) || [];
  return `${header(session.completed ? 'SESSION COMPLETE' : `ROUND ${session.roundNumber}`)}${banner()}
    <section class="session-intro">
      <p class="eyebrow eyebrow--light">${session.completed ? 'ALL FRESH PAIRS USED' : 'LIVE SHUFFLE'}</p>
      <h1>${session.completed ? 'That’s a wrap.' : 'Play the point.'}</h1>
      <p>${session.completed ? 'Every possible new teammate combination has been used. Great session.' : 'Quick scoring: each tennis point sequence earns a set; first to two sets wins the game.'}</p>
    </section>
    ${session.completed ? `<section class="card finished-card"><span>✓</span><h2>Session finished fairly</h2><p>Padelé will not create a repeated teammate pairing.</p><button class="button button--primary" data-action="new-offline">New session</button></section>` : `
      <section class="assignment card"><div class="section-heading"><p class="eyebrow">WHO PLAYS WHERE</p><h2>Round ${session.roundNumber}</h2></div>
        <div class="assignment__courts">${session.matches.map((match) => `<span><b>Court ${match.court}</b>${match.teamA.map((id) => escapeHtml(playerName(session, id))).join(' + ')} <i>vs</i> ${match.teamB.map((id) => escapeHtml(playerName(session, id))).join(' + ')}</span>`).join('')}</div>
        ${waitingNames.length ? `<div class="waiting"><b>ROTATING THIS ROUND</b><span>${waitingNames.map(escapeHtml).join(' · ')}</span></div>` : ''}
      </section>
      <section class="matches" aria-label="Active matches">${session.matches.map((match) => renderMatchCard(match, session)).join('')}</section>
      <button class="button button--lime button--large" data-action="next-round" ${allComplete ? '' : 'disabled'}>${allComplete ? 'Record results & shuffle next round →' : 'Finish every court to continue'}</button>`}
    ${renderLeaderboard(session)}
    <div class="session-actions"><button class="text-button" data-action="abandon-offline">End local session</button></div>`;
}

function cloudSetupCard() {
  return `<section class="card cloud-setup"><p class="eyebrow">ONLINE MODE</p><h1 class="page-title">Bring the club<br><em>into one room.</em></h1><p class="helper">The app is ready for a Supabase project, but this deployment has not been given its public cloud configuration yet.</p>
  <ol><li>Create a Supabase project and run the included migration.</li><li>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in the host.</li><li>Rebuild and deploy — never expose a service-role key.</li></ol>
  <button class="button button--primary" data-action="go-home">Use offline mode instead</button></section>`;
}

function renderAuth() {
  const mode = state.online.authMode;
  const signUpMode = mode === 'sign-up';
  const resetMode = mode === 'reset';
  return `<section class="card auth-card"><p class="eyebrow">ONLINE MODE</p><h1 class="page-title">${resetMode ? 'Reset your password' : signUpMode ? 'Join Padelé' : 'Welcome back'}</h1><p class="helper">${resetMode ? 'We’ll send a secure reset link.' : 'Create a room, join by code, and see scores update live.'}</p>
    <form data-form="auth">
      ${signUpMode ? '<label>Display name<input name="displayName" required maxlength="40" autocomplete="name" /></label>' : ''}
      <label>Email<input name="email" type="email" required autocomplete="email" /></label>
      ${resetMode ? '' : '<label>Password<input name="password" type="password" required minlength="8" autocomplete="current-password" /></label>'}
      <button class="button button--primary button--large" type="submit">${resetMode ? 'Send reset link' : signUpMode ? 'Create account' : 'Sign in'}</button>
    </form>
    <div class="auth-links">${resetMode ? '<button class="text-button" data-action="auth-mode" data-mode="sign-in">Back to sign in</button>' : `${signUpMode ? '<button class="text-button" data-action="auth-mode" data-mode="sign-in">Already have an account?</button>' : '<button class="text-button" data-action="auth-mode" data-mode="sign-up">Create an account</button>'}<button class="text-button" data-action="auth-mode" data-mode="reset">Forgot password?</button>`}</div>
  </section>`;
}

function renderTournamentHub() {
  scheduleDashboardExpiry();
  const currentUserId = state.online.user?.id;
  const created = state.online.tournaments.filter((tournament) => tournament.organizer_id === currentUserId && !isHiddenFromHostDashboard(tournament));
  const joined = state.online.tournaments.filter((tournament) => tournament.organizer_id !== currentUserId);
  const tournamentRow = (tournament) => `<button class="tournament-row" data-action="open-tournament" data-tournament="${tournament.id}"><span><b>${escapeHtml(tournament.name)}</b><small>${formatDateTime(tournament.starts_at)} · ${escapeHtml(tournament.venue || 'Venue to be confirmed')}</small></span><strong>${escapeHtml(tournament.code)} →</strong></button>`;
  return `<section class="card hub-card"><div class="section-heading"><div><p class="eyebrow">ONLINE MODE</p><h1 class="page-title">Your courts</h1></div><button class="text-button" data-action="sign-out">Sign out</button></div>
    <div class="online-actions"><form class="create-tournament" data-form="create-tournament"><h2>Create a tournament</h2><label>Event name<input name="name" maxlength="80" required placeholder="Friday social" /></label><div class="field-grid"><label>Venue <input name="venue" maxlength="120" required placeholder="Club or court name" /></label><label>Courts<select name="courts">${[1, 2, 3, 4, 5].map((number) => `<option value="${number}">${number}</option>`).join('')}</select></label></div><div class="field-grid"><label>Start time<input name="startsAt" type="datetime-local" required /></label><label>End time<input name="endsAt" type="datetime-local" required /></label></div><label>Scoring control<select name="scoringPermission"><option value="all_players">Any joined player</option><option value="organizers">Organizers only</option></select></label><button class="button button--primary" type="submit">Create room</button></form><form class="join-tournament" data-form="join-tournament"><h2>Join a room</h2><p>Enter the six-character code from your host.</p><div><input name="code" required maxlength="6" pattern="[A-Za-z0-9]{6}" placeholder="6-character code" autocomplete="off" /><button class="button" type="submit">Join</button></div></form></div>
    <section class="tournament-list"><div class="section-heading"><h2>Created by you</h2><span class="list-count">${created.length}</span></div>${created.length ? created.map(tournamentRow).join('') : '<p class="empty">Your scheduled rooms appear here. They hide two hours after the end time, while results stay safe.</p>'}</section>
    ${joined.length ? `<section class="tournament-list tournament-list--joined"><div class="section-heading"><h2>Joined by you</h2><span class="list-count">${joined.length}</span></div>${joined.map(tournamentRow).join('')}</section>` : ''}
  </section>`;
}

function onlinePlayerName(players, id) {
  return players.find((player) => player.id === id)?.display_name || 'Guest';
}

function onlinePairCounts(matches) {
  return matches.reduce((counts, match) => {
    [match.team_a_player_ids || [], match.team_b_player_ids || []].forEach(([left, right]) => {
      if (left && right) counts[pairKey(left, right)] = (counts[pairKey(left, right)] || 0) + 1;
    });
    return counts;
  }, {});
}

function onlinePlayCounts(matches, players) {
  const counts = Object.fromEntries(players.map((player) => [player.id, 0]));
  matches.forEach((match) => [...(match.team_a_player_ids || []), ...(match.team_b_player_ids || [])].forEach((id) => { counts[id] = (counts[id] || 0) + 1; }));
  return counts;
}

function onlineOpponentCounts(matches) {
  return matches.reduce((counts, match) => {
    (match.team_a_player_ids || []).forEach((left) => (match.team_b_player_ids || []).forEach((right) => {
      const key = pairKey(left, right);
      counts[key] = (counts[key] || 0) + 1;
    }));
    return counts;
  }, {});
}

function renderOnlineTournament() {
  const selected = state.online.selected;
  if (!selected) return '';
  const { tournament, players, rounds, matches } = selected;
  const activeMatches = matches.filter((match) => match.status === 'active');
  const isOrganizer = tournament.organizer_id === state.online.user?.id;
  return `<section class="online-room">${header(`ROOM ${tournament.code}`)}${banner()}
    <section class="room-hero"><p class="eyebrow eyebrow--light">${escapeHtml(tournament.status)}</p><h1>${escapeHtml(tournament.name)}</h1><div class="room-code"><span>ROOM CODE</span><b>${escapeHtml(tournament.code)}</b></div>${tournament.venue ? `<p>${escapeHtml(tournament.venue)}${tournament.starts_at ? ` · ${formatDateTime(tournament.starts_at)} – ${formatDateTime(tournament.ends_at)}` : ''}</p>` : ''}${isOrganizer ? '<button class="room-delete" data-action="delete-tournament">Delete tournament</button>' : ''}</section>
    <section class="card room-players"><div class="section-heading"><div><p class="eyebrow">LOBBY</p><h2>${players.length} player${players.length === 1 ? '' : 's'} joined</h2></div>${isOrganizer ? '<span class="host-badge">HOST</span>' : ''}</div><div class="player-chips">${players.map((player) => `<span>${escapeHtml(player.display_name)}${player.role === 'organizer' ? ' <b>host</b>' : ''}</span>`).join('')}</div>
      ${isOrganizer && tournament.status === 'lobby' ? '<form class="guest-form" data-form="add-guest"><input name="guestName" required maxlength="40" placeholder="Add guest player" /><button class="button" type="submit">Add guest</button></form>' : ''}
    </section>
    ${activeMatches.length ? `<section class="online-matches"><div class="section-heading section-heading--light"><div><p class="eyebrow eyebrow--light">LIVE ROUND</p><h2>Scores update for everyone</h2></div><span class="live-dot">LIVE</span></div>${activeMatches.map((match) => renderOnlineMatch(match, players)).join('')}</section>` : `<section class="card empty-round"><span>⌁</span><h2>${tournament.status === 'finished' ? 'Tournament finished' : 'Lobby is open'}</h2><p>${tournament.status === 'finished' ? 'Results stay available here.' : players.length < 4 ? 'Four players are needed for the first court.' : 'The host can shuffle fresh teams when everyone is in.'}</p>${isOrganizer && tournament.status !== 'finished' ? `<button class="button button--lime" data-action="online-start-round" ${players.length < 4 ? 'disabled' : ''}>Shuffle first round</button>` : ''}</section>`}
    <section class="card past-rounds"><h2>Round history</h2><p>${rounds.length ? `${rounds.length} round${rounds.length === 1 ? '' : 's'} created` : 'No completed rounds yet.'}</p></section>
  </section>`;
}

function renderOnlineMatch(match, players) {
  // Keep shared rooms visually and functionally identical to Offline scoring.
  const score = scoreFromHistory(match.score_history || [], QUICK_SESSION_FORMAT);
  const sideNames = (ids) => ids.map((id) => escapeHtml(onlinePlayerName(players, id))).join('<br>');
  return `<article class="match-card"><div class="match-card__header"><span>COURT ${match.court}</span><span>LIVE · FIRST TO 2 SETS</span></div><div class="match-teams"><section class="team team--a"><span>TEAM A</span><strong>${sideNames(match.team_a_player_ids)}</strong></section><div class="versus">VS</div><section class="team team--b"><span>TEAM B</span><strong>${sideNames(match.team_b_player_ids)}</strong></section></div><div class="match-score"><div><span>SETS</span><strong>${matchSetsWon(score, 'a')}</strong>${scoreSets(score, 'a')}</div><div><span>SETS</span><strong>${matchSetsWon(score, 'b')}</strong>${scoreSets(score, 'b')}</div></div><div class="point-board"><button class="score-button score-button--a" data-action="online-point" data-match="${match.id}" data-side="a" ${score.complete ? 'disabled' : ''}><span>TEAM A</span><b>${pointLabel(score, 'a')}</b><small>+ point</small></button><p class="score-status">${escapeHtml(scoreStatus(score))}</p><button class="score-button score-button--b" data-action="online-point" data-match="${match.id}" data-side="b" ${score.complete ? 'disabled' : ''}><span>TEAM B</span><b>${pointLabel(score, 'b')}</b><small>+ point</small></button></div></article>`;
}

function renderOnline() {
  if (!cloudConfigured) return `${header('ONLINE')}${cloudSetupCard()}`;
  if (state.online.loading && !state.online.user) return `${header('ONLINE')}<section class="loading-card card">Connecting to your club…</section>`;
  if (!state.online.user) return `${header('ONLINE')}${banner()}${renderAuth()}`;
  if (state.online.selected) return renderOnlineTournament();
  return `${header('ONLINE')}${banner()}${renderTournamentHub()}`;
}

function render() {
  let content;
  if (state.route === 'offline-setup') content = renderOfflineSetup();
  else if (state.route === 'offline-session') content = renderOfflineSession();
  else if (state.route === 'online') content = renderOnline();
  else content = renderHome();
  app.innerHTML = content;
}

function startOfflineSession() {
  const names = namesFromInput(state.draft.names);
  if (names.length < 4 || names.length > 20) throw new Error('Add between 4 and 20 player names.');
  const duplicates = names.map((name) => name.toLocaleLowerCase()).filter((name, index, all) => all.indexOf(name) !== index);
  if (duplicates.length) throw new Error('Each player needs a unique name.');
  const session = newOfflineSession(names, Number(state.draft.courts), state.draft.voice);
  state.offline = session;
  createOfflineRound();
  state.route = 'offline-session';
  announce(`Round one. ${state.offline.matches.length} court${state.offline.matches.length === 1 ? '' : 's'} ready.`, state.offline.voiceEnabled);
}

function createOfflineRound() {
  const session = state.offline;
  const playerIds = session.players.map((player) => player.id);
  const round = makeRound(playerIds, session.preferredCourts, session.pairCounts, session.playCounts, Math.random, session.opponentCounts || {});
  if (!round) {
    replaceOffline({ ...session, matches: [], completed: true });
    return false;
  }
  const recorded = recordRound(round, session.pairCounts, session.playCounts, session.opponentCounts || {});
  replaceOffline({
    ...session,
    roundNumber: session.roundNumber + 1,
    pairCounts: recorded.pairCounts,
    opponentCounts: recorded.opponentCounts,
    playCounts: recorded.playCounts,
    matches: round.matches.map((match) => ({ ...match, score: createScore(QUICK_SESSION_FORMAT) })),
    completed: false
  });
  return true;
}

function scoreTotals(match) {
  const { score } = match;
  const totals = {};
  const add = (ids, side) => {
    const setWins = matchSetsWon(score, side);
    const games = score.sets.reduce((sum, set) => sum + (side === 'a' ? set.a : set.b), 0);
    const points = score.history.filter((winner) => winner === side).length;
    ids.forEach((id) => { totals[id] = { sets: setWins, games, points }; });
  };
  add(match.teamA, 'a');
  add(match.teamB, 'b');
  return totals;
}

function closeOfflineRound() {
  const session = state.offline;
  if (!session.matches.every((match) => match.score.complete)) throw new Error('Finish every active court before shuffling again.');
  const results = session.matches.map((match) => {
    const winner = match.score.winner === 'a' ? match.teamA : match.teamB;
    const loser = match.score.winner === 'a' ? match.teamB : match.teamA;
    return {
      id: match.id,
      round: session.roundNumber,
      court: match.court,
      winner,
      loser,
      totals: scoreTotals(match),
      score: match.score,
      completedAt: new Date().toISOString()
    };
  });
  replaceOffline({ ...session, history: [...session.history, ...results] });
  createOfflineRound();
  if (!state.offline.completed) announce(`Round ${state.offline.roundNumber}. New teams ready.`, state.offline.voiceEnabled);
}

async function bootOnline() {
  state.route = 'online';
  if (!cloudConfigured) { render(); return; }
  state.online.loading = true;
  render();
  try {
    state.online.user = await getCurrentUser();
    if (state.online.user) {
      [state.online.profile, state.online.tournaments] = await Promise.all([getProfile(state.online.user.id), listMyTournaments()]);
    }
  } catch (error) {
    // A missing session is expected on a first visit. Configuration/RLS errors are shown.
    if (!/Auth session missing|not configured/i.test(error.message)) setNotice(friendlyServiceError(error), 'error');
  } finally {
    state.online.loading = false;
    render();
  }
}

async function openTournament(id) {
  state.online.loading = true;
  render();
  try {
    if (unsubscribeTournament) unsubscribeTournament();
    state.online.selected = await loadTournament(id);
    unsubscribeTournament = subscribeToTournament(id, async () => {
      try {
        state.online.selected = await loadTournament(id);
        render();
      } catch (error) {
        setNotice(`Live update delayed: ${friendlyServiceError(error)}`, 'error');
        render();
      }
    });
  } finally {
    state.online.loading = false;
    render();
  }
}

function resetOnlineRoom() {
  if (unsubscribeTournament) unsubscribeTournament();
  unsubscribeTournament = null;
  state.online.selected = null;
}

async function handleAction(action, button) {
  switch (action) {
    case 'go-home': resetOnlineRoom(); state.route = 'home'; setNotice(null); render(); break;
    case 'offline-setup': state.route = 'offline-setup'; setNotice(null); render(); break;
    case 'resume-offline': state.route = 'offline-session'; render(); break;
    case 'new-offline': clearOfflineSession(); state.offline = null; state.draft = { names: '', courts: 1, voice: true }; state.route = 'offline-setup'; render(); break;
    case 'abandon-offline':
      if (window.confirm('End this local session? The saved scores will be removed from this device.')) {
        clearOfflineSession(); state.offline = null; state.route = 'home'; render();
      }
      break;
    case 'dismiss-notice': setNotice(null); render(); break;
    case 'offline-point': {
      const matchId = button.dataset.match;
      const side = button.dataset.side;
      const match = state.offline.matches.find((item) => item.id === matchId);
      const previousSets = match.score.sets.length;
      const score = applyPoint(match.score, side);
      replaceOffline({ ...state.offline, matches: state.offline.matches.map((item) => item.id === matchId ? { ...item, score } : item) });
      if (score.complete) announce(`Match complete. Team ${score.winner.toUpperCase()} wins.`, state.offline.voiceEnabled);
      else if (score.sets.length > previousSets) announce(`Set to Team ${side.toUpperCase()}.`, state.offline.voiceEnabled);
      render();
      break;
    }
    case 'offline-undo': {
      const matchId = button.dataset.match;
      replaceOffline({ ...state.offline, matches: state.offline.matches.map((item) => item.id === matchId ? { ...item, score: undoPoint(item.score) } : item) });
      render();
      break;
    }
    case 'next-round': closeOfflineRound(); render(); break;
    case 'online-home': await bootOnline(); break;
    case 'auth-mode': state.online.authMode = button.dataset.mode; render(); break;
    case 'sign-out': await signOut(); resetOnlineRoom(); state.online.user = null; state.online.profile = null; state.online.tournaments = []; setNotice('Signed out.'); render(); break;
    case 'open-tournament': await openTournament(button.dataset.tournament); break;
    case 'delete-tournament': {
      const tournament = state.online.selected.tournament;
      if (!window.confirm(`Delete “${tournament.name}” permanently? This removes its players, rounds and scores.`)) break;
      await deleteTournament(tournament.id);
      resetOnlineRoom();
      state.online.tournaments = await listMyTournaments();
      setNotice('Tournament deleted permanently.');
      render();
      break;
    }
    case 'online-point': {
      const match = state.online.selected.matches.find((item) => item.id === button.dataset.match);
      try {
        const result = await recordPoint(match, button.dataset.side);
        const score = scoreFromHistory(result.score_history || [], QUICK_SESSION_FORMAT);
        state.online.selected = {
          ...state.online.selected,
          matches: state.online.selected.matches.map((item) => item.id === match.id ? {
            ...item,
            score_history: result.score_history,
            score_version: result.score_version,
            status: score.complete ? 'completed' : item.status,
            winner_side: score.complete ? score.winner : item.winner_side
          } : item)
        };
      } catch (error) {
        if (error?.code === '40001' || /score changed/i.test(error?.message || '')) {
          state.online.selected = await loadTournament(state.online.selected.tournament.id);
        }
        throw error;
      }
      render();
      break;
    }
    case 'online-start-round': {
      const selected = state.online.selected;
      const ids = selected.players.map((player) => player.id);
      const pairingHistory = await loadPairingHistory(selected.tournament.id);
      const result = makeRound(ids, selected.tournament.preferred_courts, onlinePairCounts(pairingHistory), onlinePlayCounts(pairingHistory, selected.players), Math.random, onlineOpponentCounts(pairingHistory));
      if (!result) throw new Error('No full court can be created without repeating a teammate pair.');
      await startRound(selected.tournament.id, result.matches, result.waiting);
      state.online.selected = await loadTournament(selected.tournament.id);
      render();
      break;
    }
    default: break;
  }
}

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  try {
    await handleAction(button.dataset.action, button);
  } catch (error) {
    setNotice(friendlyServiceError(error), 'error');
    render();
  }
});

app.addEventListener('input', (event) => {
  const field = event.target.dataset.draft;
  if (!field) return;
  state.draft[field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  if (field === 'names') updateSetupPreview();
});

function updateSetupPreview() {
  const count = namesFromInput(state.draft.names).length;
  const courts = Number(state.draft.courts);
  const capacity = count >= 4 && count <= 20 ? roundCapacity(count, courts) : null;
  const playerCount = document.querySelector('#player-count');
  const heading = document.querySelector('#plan-heading');
  const detail = document.querySelector('#plan-detail');
  const card = document.querySelector('#plan-card');
  const start = document.querySelector('#start-shuffle');
  if (!playerCount || !heading || !detail || !card || !start) return;
  playerCount.textContent = `${count}/20`;
  playerCount.classList.toggle('player-count--limit', count > 20);
  heading.textContent = capacity ? `${capacity.courts} court${capacity.courts === 1 ? '' : 's'} ready` : 'Your court plan';
  detail.textContent = setupEstimate(count, courts);
  card.classList.toggle('plan-card--muted', !capacity);
  start.disabled = count < 4 || count > 20;
}

app.addEventListener('change', (event) => {
  const field = event.target.dataset.draft;
  if (!field) return;
  state.draft[field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  if (field === 'courts') render();
});

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.dataset.form === 'offline-start') {
      startOfflineSession();
      render();
    }
    if (form.dataset.form === 'auth') {
      const fields = new FormData(form);
      const email = fields.get('email');
      if (state.online.authMode === 'reset') {
        await resetPasswordForEmail(email);
        setNotice('Password reset link sent — check your inbox.');
      } else if (state.online.authMode === 'sign-up') {
        await signUp(email, fields.get('password'), fields.get('displayName'));
        setNotice('Account created. Check your inbox if email confirmation is enabled.');
      } else {
        state.online.user = await signIn(email, fields.get('password'));
        [state.online.profile, state.online.tournaments] = await Promise.all([getProfile(state.online.user.id), listMyTournaments()]);
      }
      render();
    }
    if (form.dataset.form === 'create-tournament') {
      const fields = new FormData(form);
      const startsAt = new Date(fields.get('startsAt'));
      const endsAt = new Date(fields.get('endsAt'));
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) throw new Error('Choose an end time after the start time.');
      const tournament = await createTournament({ name: fields.get('name'), venue: fields.get('venue'), preferredCourts: Number(fields.get('courts')), scoringPermission: fields.get('scoringPermission'), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
      state.online.tournaments = await listMyTournaments();
      await openTournament(tournament.id);
    }
    if (form.dataset.form === 'join-tournament') {
      const fields = new FormData(form);
      const tournament = await joinTournament(fields.get('code'));
      state.online.tournaments = await listMyTournaments();
      await openTournament(tournament.id);
    }
    if (form.dataset.form === 'add-guest') {
      const fields = new FormData(form);
      await addGuestPlayer(state.online.selected.tournament.id, fields.get('guestName'));
      state.online.selected = await loadTournament(state.online.selected.tournament.id);
      render();
    }
  } catch (error) {
    setNotice(friendlyServiceError(error), 'error');
    render();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}

if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    state.online.user = session?.user || null;
  });
}

render();
