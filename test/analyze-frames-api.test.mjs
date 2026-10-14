import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NVIDIA_API_KEY = 'nvapi-test-only-not-real';
const { default: analyzeFrames } = await import('../api/nim/analyze-frames.js');

function fakeRes() {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(chunk) { this.body = chunk ?? ''; this.resolve?.(); },
  };
  res.done = new Promise(resolve => { res.resolve = resolve; });
  return res;
}
async function run(req) {
  const res = fakeRes();
  await analyzeFrames(req, res);
  await res.done;
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
const tinyJpeg = 'data:image/jpeg;base64,AAAA';

test('rejects non-POST requests', async () => {
  assert.equal((await run({ method: 'GET' })).status, 405);
});

test('rejects an empty frame list and more than the per-request maximum', async () => {
  assert.equal((await run({ method: 'POST', body: { frames: [] } })).status, 400);
  const tooMany = Array.from({ length: 9 }, () => ({ timestampSeconds: 1, dataUrl: tinyJpeg }));
  assert.equal((await run({ method: 'POST', body: { frames: tooMany } })).status, 400);
});

test('rejects non-image data and bad timestamps before any network call', async () => {
  const badData = await run({ method: 'POST', body: { frames: [{ timestampSeconds: 1, dataUrl: 'https://example.com/x.jpg' }] } });
  assert.equal(badData.status, 400);
  assert.match(badData.body.detail, /not a small JPEG or PNG/);
  const badTime = await run({ method: 'POST', body: { frames: [{ timestampSeconds: -4, dataUrl: tinyJpeg }] } });
  assert.equal(badTime.status, 400);
  assert.match(badTime.body.detail, /invalid timestamp/);
});
