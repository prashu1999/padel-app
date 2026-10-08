/*
 * Guarded live test. It reads local credentials only and prints no tokens,
 * email addresses, or passwords. It intentionally preserves its audit data.
 */
import fs from 'node:fs';

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }));
}

const env = { ...loadEnv('.env.local'), ...loadEnv('.env.test.local') };
if (env.PADELE_RUN_LIVE_TESTS !== 'true') {
  throw new Error('Refusing to create audit records. Set PADELE_RUN_LIVE_TESTS=true in .env.test.local.');
}
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'TEST_USER_EMAIL', 'TEST_USER_PASSWORD']) {
  if (!env[key]) throw new Error(`Missing ${key} in local environment files.`);
}

const metrics = [];
const api = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
let accessToken;

function transientResponse(response, data) {
  return [502, 503, 504, 429].includes(response.status)
    || /schema cache|could not query the database|connection pool/i.test(data?.message || data?.msg || '');
}

async function request(name, path, options = {}, { read = false } = {}) {
  const started = performance.now();
  const attempts = read ? 3 : 1;
  let response;
  let data;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    response = await fetch(`${api}${path}`, {
      ...options,
      headers: {
        apikey: key,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
    data = await response.json().catch(() => null);
    if (response.ok || !transientResponse(response, data) || attempt === attempts - 1) break;
    await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
  }
  metrics.push({
    operation: name,
    status: response.status,
    durationMs: Math.round((performance.now() - started) * 10) / 10,
    attempts
  });
  if (!response.ok) throw new Error(`${name} failed (${response.status}): ${data?.message || data?.msg || 'unknown error'}`);
  return data;
}

try {
  const session = await request('password_login', '/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: env.TEST_USER_EMAIL, password: env.TEST_USER_PASSWORD })
  });
  accessToken = session.access_token;
  const userId = session.user.id;

  await request('profile_load', `/rest/v1/profiles?select=id,display_name,avatar_url&id=eq.${encodeURIComponent(userId)}`, {}, { read: true });
  await request('membership_list_before', '/rest/v1/tournament_players?select=id,role,tournament_id', {}, { read: true });

  const created = await request('tournament_create', '/rest/v1/rpc/create_tournament', {
    method: 'POST',
    body: JSON.stringify({
      p_name: `Audit ${new Date().toISOString().replace(/[:.]/g, '-')}`,
      p_venue: 'Automated audit',
      p_preferred_courts: 1,
      p_scoring_permission: 'all_players'
    })
  });
  const tournament = Array.isArray(created) ? created[0] : created;
  if (!/^[A-F0-9]{6}$/.test(tournament.code)) throw new Error('Tournament code was not a six-character uppercase code.');

  await request('guest_add_1', '/rest/v1/rpc/add_guest_player', { method: 'POST', body: JSON.stringify({ p_tournament_id: tournament.id, p_display_name: 'Audit Guest 1' }) });
  await request('guest_add_2', '/rest/v1/rpc/add_guest_player', { method: 'POST', body: JSON.stringify({ p_tournament_id: tournament.id, p_display_name: 'Audit Guest 2' }) });
  await request('guest_add_3', '/rest/v1/rpc/add_guest_player', { method: 'POST', body: JSON.stringify({ p_tournament_id: tournament.id, p_display_name: 'Audit Guest 3' }) });
  const players = await request('lobby_load', `/rest/v1/tournament_players?select=id,display_name,role,is_guest&tournament_id=eq.${tournament.id}&order=created_at.asc`, {}, { read: true });
  if (players.length !== 4) throw new Error('Expected the organizer and three audit guests.');

  const round = await request('round_create', '/rest/v1/rpc/create_round_with_matches', {
    method: 'POST',
    body: JSON.stringify({
      p_tournament_id: tournament.id,
      p_matches: [{ court: 1, team_a_player_ids: [players[0].id, players[1].id], team_b_player_ids: [players[2].id, players[3].id] }],
      p_waiting_player_ids: []
    })
  });
  const roundId = (Array.isArray(round) ? round[0] : round).id;
  const matches = await request('active_match_load', `/rest/v1/matches?select=id,score_version,score_history,status&round_id=eq.${roundId}&status=eq.active`, {}, { read: true });
  const match = matches[0];
  const score = await request('score_point', '/rest/v1/rpc/record_score_event', {
    method: 'POST',
    body: JSON.stringify({ p_match_id: match.id, p_expected_version: match.score_version, p_action_id: crypto.randomUUID(), p_side: 'a', p_complete: false, p_winner_side: null, p_score_state: {} })
  });
  if ((Array.isArray(score) ? score[0] : score).score_version !== 1) throw new Error('Score version did not advance atomically.');
  await request('membership_list_after', '/rest/v1/tournament_players?select=id,role,tournament_id', {}, { read: true });

  console.log(JSON.stringify({ passed: true, createdAuditTournament: true, metrics }, null, 2));
} catch (error) {
  // Keep diagnostics useful without ever printing local credentials or tokens.
  console.error(JSON.stringify({
    passed: false,
    error: error?.cause?.code === 'ENOTFOUND'
      ? 'DNS could not resolve the Supabase project hostname from this machine.'
      : (error?.message || 'Unknown live-test failure.'),
    metrics
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (accessToken) {
    await fetch(`${api}/auth/v1/logout`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${accessToken}` } }).catch(() => {});
  }
}
