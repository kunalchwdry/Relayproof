import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, secretsFromEnv } from '../scripts/bundle-secrets.mjs';

test('flags token-shaped strings in a bundle', () => {
  assert.equal(scanText('a.js', 'const k="nvapi-abcdefghijklmnop1234";').length, 1);
  assert.equal(scanText('a.js', 'x="hf_abcdefghijklmnopqrstuvwxyz0123456789"').length, 1);
  assert.equal(scanText('a.js', 'x="vcp_abcdefghijklmnopqrstu"').length, 1);
  assert.equal(scanText('a.js', 'x="AIzaSyA-abcdefghijklmnopqrstuvwxyz12345"').length, 1);
});

test('does not flag ordinary code or short words', () => {
  assert.equal(scanText('a.js', 'const hf_ = 1; function nvapi() {} // hf_short').length, 0);
  assert.equal(scanText('a.js', 'sha256 deadbeef '.repeat(20)).length, 0);
});

test('flags an exact configured secret value even without a known prefix', () => {
  const secrets = [{ name: 'SERPAPI_KEY', value: 'plainsecretvalue123' }];
  const hits = scanText('b.js', 'const t = "plainsecretvalue123";', secrets);
  assert.deepEqual(hits, [{ file: 'b.js', rule: 'value of SERPAPI_KEY' }]);
});

test('ignores empty or very short configured values', () => {
  assert.equal(scanText('c.js', 'a b c', [{ name: 'X', value: '' }, { name: 'Y', value: 'abc' }]).length, 0);
});

test('reads secrets only from the named environment variables', () => {
  const found = secretsFromEnv({ NVIDIA_API_KEY: ' nvapi-value-123456 ', UNRELATED: 'something-long-here', SERPAPI_KEY: '' });
  assert.deepEqual(found, [{ name: 'NVIDIA_API_KEY', value: 'nvapi-value-123456' }]);
});
