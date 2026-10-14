import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonLoose } from '../lib/nim.js';

test('parses plain JSON', () => {
  assert.deepEqual(parseJsonLoose('{"verdict":"supported"}'), { verdict: 'supported' });
});

test('recovers JSON wrapped in a code fence or prose', () => {
  assert.deepEqual(parseJsonLoose('Here you go:\n```json\n{"claims": []}\n```'), { claims: [] });
});

test('returns null when there is no object or the object is malformed', () => {
  assert.equal(parseJsonLoose('no json here'), null);
  assert.equal(parseJsonLoose('{"broken": }'), null);
  assert.equal(parseJsonLoose('} backwards {'), null);
});
