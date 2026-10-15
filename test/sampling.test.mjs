import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSampleTimes, frameDifference } from '../src/analysis/sampling.js';

test('returns at most count moments, sorted, and covers the start and end of the clip', () => {
  const candidates = Array.from({ length: 60 }, (_, i) => ({ time: i * 2, diff: 0 }));
  const picked = chooseSampleTimes(candidates, 16, 120);
  assert.ok(picked.length <= 16);
  assert.deepEqual(picked, [...picked].sort((a, b) => a - b));
  assert.ok(picked[0] <= 4, 'starts near the beginning');
  assert.ok(picked[picked.length - 1] >= 114, 'reaches near the end');
});

test('a sudden change between samples is kept even when it is not on the even grid', () => {
  // Even spacing for 16 frames over 300 s is every ~20 s; a cut at 47 s falls between them.
  const candidates = Array.from({ length: 150 }, (_, i) => ({ time: i * 2, diff: i * 2 === 46 ? 0.9 : 0.01 }));
  const picked = chooseSampleTimes(candidates, 16, 300);
  assert.ok(picked.includes(46), `expected 46 in ${picked}`);
});

test('no duplicates closer together than half a step', () => {
  const candidates = Array.from({ length: 100 }, (_, i) => ({ time: i, diff: Math.random() }));
  const picked = chooseSampleTimes(candidates, 10, 100);
  for (let i = 1; i < picked.length; i += 1) assert.ok(picked[i] - picked[i - 1] >= 1);
});

test('empty input gives no moments', () => {
  assert.deepEqual(chooseSampleTimes([], 16, 60), []);
});

test('frameDifference is 0 for identical frames and 1 for opposite frames', () => {
  assert.equal(frameDifference(new Uint8Array([10, 20, 30]), new Uint8Array([10, 20, 30])), 0);
  assert.equal(frameDifference(new Uint8Array([0, 0]), new Uint8Array([255, 255])), 1);
  assert.equal(frameDifference(new Uint8Array([1]), new Uint8Array([1, 2])), 0);
});
