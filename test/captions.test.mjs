import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptions } from '../src/analysis/captions.js';

test('SRT cue numbers and timing lines are dropped', () => {
  const srt = '1\n00:00:00,000 --> 00:00:02,000\nHello there.\n\n2\n00:00:02,500 --> 00:00:04,000\nSend money now.\n';
  assert.equal(parseCaptions(srt), 'Hello there. Send money now.');
});

test('WebVTT header, NOTE blocks and inline tags are removed', () => {
  const vtt = 'WEBVTT\n\nNOTE generated\n\n00:00.000 --> 00:02.000\n<c.yellow>Guaranteed returns</c>\n';
  assert.equal(parseCaptions(vtt), 'Guaranteed returns');
});

test('plain text is only whitespace-normalised', () => {
  assert.equal(parseCaptions('  one\r\n\r\n two   three \n'), 'one two three');
});
