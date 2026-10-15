import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVERSE_IMAGE_SEARCHES, frameFileName } from '../src/analysis/reverseSearch.js';

test('every reverse-search link is https and has a plain-language instruction', () => {
  assert.ok(REVERSE_IMAGE_SEARCHES.length >= 2);
  for (const engine of REVERSE_IMAGE_SEARCHES) {
    assert.match(engine.url, /^https:\/\//);
    assert.ok(engine.howTo.length > 10);
  }
});

test('frame file names are safe and include the moment', () => {
  assert.equal(frameFileName('My Clip (final).mp4', 52.4), 'My-Clip-final-52s.jpg');
  assert.equal(frameFileName('../../etc/passwd', 3), 'etc-passwd-3s.jpg');
  assert.equal(frameFileName('', 0), 'clip-0s.jpg');
  assert.equal(frameFileName(undefined, -4), 'clip-0s.jpg');
});
