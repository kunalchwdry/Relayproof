import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NVIDIA_API_KEY = 'nvapi-test-only-not-real';
const { default: status } = await import('../api/nim/status.js');
const { default: ocr } = await import('../api/nim/ocr.js');
const { default: explain } = await import('../api/nim/explain.js');

function fakeRes() {
  const res = {
    statusCode: 200, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(chunk) { this.body = chunk ?? ''; this.headersSent = true; this.resolve?.(); },
  };
  res.done = new Promise(resolve => { res.resolve = resolve; });
  return res;
}
async function run(handler, req) {
  const res = fakeRes();
  await handler(req, res);
  await res.done.catch(() => {});
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

test('status reports configuration without exposing the key', async () => {
  const { status: code, body } = await run(status, { method: 'GET' });
  assert.equal(code, 200);
  assert.equal(body.configured, true);
  assert.equal(body.transcriptionAvailable, false);
  assert.ok(!JSON.stringify(body).includes('nvapi-'), 'key must never appear in the response');
});

test('ocr rejects non-image data URLs before calling NVIDIA', async () => {
  const { status: code, body } = await run(ocr, { method: 'POST', body: { frames: [{ timestampSeconds: 1, dataUrl: 'javascript:alert(1)' }] } });
  assert.equal(code, 400);
  assert.match(body.detail, /not a small JPEG or PNG/);
});

test('ocr rejects empty or oversized frame lists', async () => {
  assert.equal((await run(ocr, { method: 'POST', body: { frames: [] } })).status, 400);
  const many = Array.from({ length: 9 }, () => ({ timestampSeconds: 1, dataUrl: 'data:image/jpeg;base64,AA==' }));
  assert.equal((await run(ocr, { method: 'POST', body: { frames: many } })).status, 400);
});

test('explain rejects non-object bodies and only forwards whitelisted fields', async () => {
  assert.equal((await run(explain, { method: 'POST', body: 'nope' })).status, 400);
  assert.equal((await run(explain, { method: 'GET' })).status, 405);
});
