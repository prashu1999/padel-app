import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyServiceError, isTransientServiceError, retryRead } from './query.js';

test('retries only transient connection-pool failures with backoff', async () => {
  let calls = 0;
  const delays = [];
  const value = await retryRead(async () => {
    calls += 1;
    if (calls < 3) throw new Error('Timed out acquiring connection from connection pool.');
    return 'ok';
  }, { baseDelayMs: 5, sleep: async (ms) => { delays.push(ms); } });
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [5, 10]);
});

test('does not retry permission errors and provides a user-safe message', async () => {
  const error = new Error('new row violates row-level security policy');
  assert.equal(isTransientServiceError(error), false);
  await assert.rejects(() => retryRead(async () => { throw error; }), error);
  assert.match(friendlyServiceError(error), /permission/i);
});

test('treats a temporary PostgREST schema-cache response as retriable', () => {
  assert.equal(isTransientServiceError(new Error('Could not query the database for the schema cache. Retrying.')), true);
});
