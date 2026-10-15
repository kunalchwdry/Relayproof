import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postJson } from '../src/analysis/request.js';

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init.body });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status < 400, status: next.status, json: async () => next.body };
  };
  return { fetchImpl, calls };
}

test('returns the payload on success without retrying', async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { ok: 1 } }]);
  assert.deepEqual(await postJson('/x', { a: 1 }, { fetchImpl, delayMs: 0 }), { ok: 1 });
  assert.equal(calls.length, 1);
});

test('retries once on a 504 timeout and then succeeds', async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 504, body: { detail: 'NVIDIA NIM did not answer in time.' } }, { status: 200, body: { ok: 2 } }]);
  assert.deepEqual(await postJson('/x', {}, { fetchImpl, delayMs: 0 }), { ok: 2 });
  assert.equal(calls.length, 2);
});

test('retries a network failure, then reports a readable message', async () => {
  const { fetchImpl, calls } = fakeFetch([new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]);
  await assert.rejects(postJson('/x', {}, { fetchImpl, delayMs: 0 }), /Could not reach the analysis service/);
  assert.equal(calls.length, 2);
});

test('does not retry a client error such as 400', async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 400, body: { detail: 'bad frame' } }, { status: 200, body: {} }]);
  await assert.rejects(postJson('/x', {}, { fetchImpl, delayMs: 0 }), /bad frame/);
  assert.equal(calls.length, 1);
});

test('a cancelled request stops at once and is not retried', async () => {
  const controller = new AbortController();
  controller.abort();
  const { fetchImpl, calls } = fakeFetch([{ status: 200, body: {} }]);
  await assert.rejects(postJson('/x', {}, { fetchImpl, delayMs: 0, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 0);
});

test('cancelling during the wait before a retry stops the retry', async () => {
  const controller = new AbortController();
  const { fetchImpl, calls } = fakeFetch([{ status: 503, body: {} }, { status: 200, body: { ok: 3 } }]);
  const pending = postJson('/x', {}, { fetchImpl, delayMs: 60_000, signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls.length, 1);
});

test('an HTTP error carries its status so the page can explain it', async () => {
  const { fetchImpl } = fakeFetch([{ status: 503, body: { detail: 'NVIDIA NIM is not configured on the server.' } }, { status: 503, body: { detail: 'NVIDIA NIM is not configured on the server.' } }]);
  await assert.rejects(postJson('/x', {}, { fetchImpl, delayMs: 0 }), error => error.status === 503);
});
