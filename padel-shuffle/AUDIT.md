# Online reliability and performance audit

## Executed checks

- Unit tests: **13 passed** (scoring, offline shuffle, retry/backoff, Realtime coalescing).
- Production Vite build: **passed**.
- Supabase public Auth settings endpoint: previously returned **HTTP 200** with the configured project URL and publishable key.
- Migration RPC probe: `create_tournament` returned **401 Sign in is required** before login, confirming the RPC exists and enforces authentication.
- Live authenticated smoke test: blocked in this executor by DNS (`ENOTFOUND` for the Supabase hostname). The guarded local runner is included as `npm run test:live`; it does not log credentials or tokens.

## Root cause of excess database pressure

This project did not show evidence of a single slow SQL statement from this executor. The client code did, however, have a high amplification pattern:

1. Every database event in a room triggered a refresh immediately.
2. Each refresh performed four reads, using `select('*')` and loading all rounds and all matches.
3. Every scored point also forced a full room reload locally, then triggered another full reload through Realtime.

With multiple users scoring, this multiplies reads and can exhaust a small Supabase connection pool. It is the identified application-side contributor to `Timed out acquiring connection from connection pool`.

## Implemented fixes

- One shared Supabase client remains in `src/lib/supabase.js`.
- Initial session lookup uses persisted `getSession()` rather than a network `getUser()` request.
- Read-only profile/tournament queries retry only transient failures with bounded exponential backoff (180 ms, then 360 ms). Writes are not automatically retried, avoiding accidental duplicate tournaments.
- The live room selects only required columns and active matches; full pairing history is fetched only when the host shuffles the next round.
- Realtime uses one channel per open tournament, debounces bursts to one refresh, serializes in-flight refreshes, and clears timers/channels on cleanup.
- A scorer updates its local score from the atomic RPC result instead of immediately reloading the entire room. Version conflicts load fresh data and display a clear message.
- Membership and tournament list reads no longer use a PostgREST relationship embed, eliminating the reported ambiguous-relationship error.

## Realtime decision

Keep Realtime enabled for `tournaments`, `tournament_players`, `rounds`, and `matches`: these drive room/lobby/round/live-score UI. Keep it disabled for `profiles`, `player_stats`, and `match_score_events`: the app does not subscribe to them, so enabling them would add unnecessary replication work.

## Required SQL

Run these in Supabase SQL Editor in order if they have not already been applied:

1. `supabase/migrations/002_repair_online_connection.sql` — fixes room-code generation without deleting data.
2. `supabase/migrations/003_performance_fixes.sql` — adds indexes for lobby, rounds and active-match queries only.

## Remaining live verification

Run `npm run test:live` on the development Mac after restarting the local app. It requires `PADELE_RUN_LIVE_TESTS=true` in ignored `.env.test.local`, creates clearly named audit records, writes one atomic score event, and signs out. It never prints credentials or tokens.

For join-room and multi-user Realtime verification, create a second dedicated, non-admin test account. Do not use a personal administrator account.
