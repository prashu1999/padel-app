# Padelé

Padelé is a mobile-first padel session manager that works in two modes:

- **Offline:** local-only 4–20 player sessions, 1–5 courts, fair waits, strict no-repeat teammates, native voice calls, and local persistence.
- **Online:** optional Supabase-backed accounts, scheduled rooms, guest players, room-code join, live score events, and RLS-protected tournament data.

The offline app is fully usable without an account, network, or Supabase project.

## Rules built in

- **Offline quick sessions:** `0 → 15 → 30 → 40`, deuce and advantage award one set; first to two sets wins the game, so 1–1 has a deciding set.
- **Online tournaments:** use the exact same quick-session score as Offline: a tennis point sequence wins one set; first to two sets wins the game; 1–1 has a deciding set.
- Online hosts set a venue, start time and end time. Their room is hidden from the dashboard two hours after its scheduled end, but its results are retained.
- Online includes RSVP availability, live court/waiting assignments, host-only score undo, shareable room invitations, a live leaderboard, player results, archive/restore, and host controls for guest removal and room details.
- A teammate pairing is used once only. Padelé will not create a later round that repeats one; it ends the session once a full fresh-pair round cannot be made.
- Four players are assigned per active court. Extra players rotate out based on their number of appearances, so a 7-player/1-court session assigns four and rotates three.
- Opponent history is retained and used as a preference when pairing courts, reducing repeat matchups without relaxing the teammate rule.

## Local development

Requires Node 20+ and a package manager such as npm or pnpm.

```sh
cd outputs/padel-shuffle
npm install
npm run dev
```

Open the printed local URL. The app includes a service worker, so use HTTP(S), not `file://`.

### Verification

```sh
npm test
npm run build
```

The test suite covers deuce/advantage, set and match wins, a win-by-two tiebreak, undo/replay, 7-player rotation, court caps, and prevention of repeated teammate pairs.

### Optional live Supabase smoke test

Create a dedicated non-admin account, copy [`.env.test.example`](.env.test.example) to `.env.test.local`, and supply its credentials locally. The file is ignored by Git. Set `PADELE_RUN_LIVE_TESTS=true`, then run:

```sh
npm run test:live
```

This signs in, measures each operation, creates a clearly named audit tournament with three audit guests, creates a round, writes one atomic score event, and signs out. It never prints credentials or tokens and deliberately does **not** delete audit records. A second dedicated test account is required for join-room and multi-user Realtime verification.

## Configure Online mode (Supabase)

1. Create a Supabase project.
2. Run the migrations in order in the Supabase SQL Editor: [`001_padele.sql`](supabase/migrations/001_padele.sql), [`002_repair_online_connection.sql`](supabase/migrations/002_repair_online_connection.sql), [`003_performance_fixes.sql`](supabase/migrations/003_performance_fixes.sql), [`004_tournament_schedule_and_host_controls.sql`](supabase/migrations/004_tournament_schedule_and_host_controls.sql), and [`005_online_tournament_experience.sql`](supabase/migrations/005_online_tournament_experience.sql). The final migration adds RSVP, archive/restore, host controls, and safe score correction.
3. In the site host, set only these public build variables:

   ```sh
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

4. Rebuild and deploy.

Never add a Supabase `service_role` or secret key to this app, a `.env` committed to Git, or browser code. Browser access is limited with RLS and each point is an idempotent, version-checked score event. If two devices score at once, the stale version is rejected instead of overwriting the newest point.

For authentication, enable the email provider in Supabase Auth and configure the production site URL plus allowed redirect URL. Online rooms intentionally remain unavailable until the two Vite variables are supplied.

## GitHub Pages

The Vite config uses a relative base so the compiled app works at both `username.github.io` and `username.github.io/repository-name`.

1. Push this `padel-shuffle` directory to a GitHub repository.
2. In **Settings → Pages**, select **GitHub Actions** as the source.
3. Add repository **Variables** named `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` if you want online mode; leave them absent for offline-only deployment. These are Supabase publishable browser values, not secret/service keys.
4. Use the workflow at [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml), or run `npm run build` and publish `dist/` from another host.
5. After the first deployment, copy its GitHub Pages URL into **Supabase → Authentication → URL Configuration** as the Site URL and an allowed Redirect URL. This makes password-reset links return to your app.

GitHub Pages is HTTPS, so installed PWA and service worker behavior are available on iPhone after the first load.

## iPhone installation

Open the public HTTPS deployment in **Safari** on the iPhone, then tap **Share → Add to Home Screen → Add**. Offline session data stays in Safari’s local storage on that phone; clearing Safari website data removes it.

## Project layout

```text
src/scoring.js              Pure shared tennis scoring engine
src/shuffle.js              Fair pairing and rotation engine
src/main.js                 Mobile UI and offline/online flows
src/services/               Auth, tournament and Realtime clients
supabase/migrations/        RLS schema and atomic score-event RPCs
public/                     PWA manifest, service worker and assets
dist/                       Generated deployable build (not committed)
```

## Manual acceptance checklist

- Start a session with 4, 7, 12 and 20 players; verify active courts and waiting players.
- Finish several rounds and confirm a teammate pair never appears twice.
- Offline and Online: exercise 40–40, advantage back to deuce, and the 1–1 deciding set.
- Reload mid-round: the local session, current points, assignments and leaderboard should remain.
- On an iPhone, install the HTTPS build and reopen it offline after one successful load.
- After Supabase setup, create a room, join from a second signed-in browser, add a guest, score a point from either allowed device, and verify the live score update.
