import test from 'node:test';
import assert from 'node:assert/strict';
import { createTournamentSubscription } from './realtime.js';

test('coalesces bursts of tournament realtime changes into one refresh and cleans up', async () => {
  const handlers = [];
  let removed = false;
  const channel = {
    on(_event, _filter, handler) { handlers.push(handler); return this; },
    subscribe() { return this; }
  };
  const db = { channel: () => channel, removeChannel: () => { removed = true; } };
  let refreshes = 0;
  const stop = createTournamentSubscription(db, 'tournament-1', async () => { refreshes += 1; }, { debounceMs: 1 });
  handlers.forEach((handler) => handler({}));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(refreshes, 1);
  stop();
  handlers[0]({});
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(refreshes, 1);
  assert.equal(removed, true);
});
