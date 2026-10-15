import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapFactCheckResponse, searchFactChecks } from '../lib/factcheck.js';
import { gatherEvidence } from '../lib/evidence.js';

const fixture = {
  claims: [
    { text: 'Water boils at 90 C at sea level', claimReview: [
      { publisher: { name: 'Example Fact Desk', site: 'example.org' }, url: 'https://example.org/check/1', title: 'Water boiling point', textualRating: 'False', reviewDate: '2026-03-02T00:00:00Z' },
      { publisher: { site: 'other.org' }, url: 'http://insecure.example/x', title: 'not https', textualRating: 'True' },
    ] },
    { text: 'Another claim', claimReview: [{ publisher: { name: 'B' }, url: 'https://b.example/2', textualRating: 'Mostly true' }] },
  ],
};

test('maps fact-check claims to sources, skipping non-https links', () => {
  const results = mapFactCheckResponse(fixture, 5);
  assert.equal(results.length, 2);
  assert.equal(results[0].rating, 'False');
  assert.equal(results[0].publisher, 'Example Fact Desk');
  assert.equal(results[1].publisher, 'B');
  assert.ok(results.every(r => r.link.startsWith('https://')));
});

test('respects the limit and tolerates an empty or odd response', () => {
  assert.equal(mapFactCheckResponse(fixture, 1).length, 1);
  assert.deepEqual(mapFactCheckResponse({}, 3), []);
  assert.deepEqual(mapFactCheckResponse(null, 3), []);
});

test('sends the key in a header, not the URL, and never throws on a network failure', async () => {
  process.env.FACT_CHECK_API_KEY = 'test-fact-key-000000000000';
  let seen = null;
  const ok = await searchFactChecks('water boils', { fetchImpl: async (url, init) => { seen = { url: String(url), init }; return { ok: true, json: async () => fixture }; } });
  assert.equal(ok.results.length, 2);
  assert.ok(!seen.url.includes('test-fact-key'), 'key must not appear in the URL');
  assert.equal(seen.init.headers['X-goog-api-key'], 'test-fact-key-000000000000');
  const failed = await searchFactChecks('x', { fetchImpl: async () => { throw new Error('boom'); } });
  assert.equal(failed.results.length, 0);
  assert.equal(failed.error, 'fact-check search failed');
  delete process.env.FACT_CHECK_API_KEY;
  assert.deepEqual(await searchFactChecks('x', { fetchImpl: async () => { throw new Error('should not be called'); } }), { available: false, results: [], error: null });
});

test('uses published fact checks first and only falls back to web search when they find nothing', async () => {
  let webCalls = 0;
  const webSearch = async () => { webCalls += 1; return { available: true, results: [{ title: 'W', link: 'https://w.example', snippet: 's' }], error: null }; };
  const withChecks = await gatherEvidence('claim', { factCheck: async () => ({ available: true, results: mapFactCheckResponse(fixture, 3), error: null }), webSearch });
  assert.equal(withChecks.evidenceSource, 'factcheck');
  assert.equal(webCalls, 0);
  assert.match(withChecks.snippets[0].snippet, /Rating: "False"/);

  const fallback = await gatherEvidence('claim', { factCheck: async () => ({ available: true, results: [], error: null }), webSearch });
  assert.equal(fallback.evidenceSource, 'web');
  assert.equal(webCalls, 1);
});

test('reports no evidence source when neither service is configured', async () => {
  const none = await gatherEvidence('claim', { factCheck: async () => ({ available: false, results: [], error: null }), webSearch: async () => ({ available: false, results: [], error: null }) });
  assert.equal(none.evidenceSource, 'none');
  assert.equal(none.searchUsed, false);
  assert.equal(none.evidenceLabel, 'No evidence source configured');
});
