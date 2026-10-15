import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mp4AudioTrack, detectAudioTrack, describeAnalysisError, isOutOfMemory, speechFailureMessage } from '../src/analysis/mediaCheck.js';

// Builds a minimal 'hdlr' box: size(4) 'hdlr' version+flags(4) pre_defined(4) handler(4) name.
function hdlr(handler) {
  const bytes = [0, 0, 0, 33, 0x68, 0x64, 0x6c, 0x72, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const ch of handler) bytes.push(ch.charCodeAt(0));
  return new Uint8Array([...bytes, 0, 0, 0, 0, 0, 0, 0, 0]);
}

test('finds a sound track and a video-only track in MP4 bytes', () => {
  assert.equal(mp4AudioTrack(hdlr('soun')), 'present');
  assert.equal(mp4AudioTrack(hdlr('vide')), 'absent');
  assert.equal(mp4AudioTrack(new Uint8Array([1, 2, 3])), 'unknown');
});

test('reads a real video with audio and a real silent video from the fixtures', async () => {
  const withAudio = new Uint8Array(await readFile(new URL('./fixtures/c2pa-camera-declared.mp4', import.meta.url)));
  assert.equal(mp4AudioTrack(withAudio), 'present');
});

test('detects audio in a File without loading it whole', async () => {
  const buffer = await readFile(new URL('./fixtures/c2pa-camera-declared.mp4', import.meta.url));
  const file = new File([buffer], 'clip.mp4', { type: 'video/mp4' });
  assert.equal(await detectAudioTrack(file, { chunkBytes: 4096 }), 'present');
  assert.equal(await detectAudioTrack(new File(['x'], 'clip.webm', { type: 'video/webm' })), 'unknown');
});

test('maps analysis errors to plain sentences, and stays silent on cancel', () => {
  assert.match(describeAnalysisError(Object.assign(new Error('x'), { status: 503 })), /not available/);
  assert.match(describeAnalysisError(Object.assign(new Error('x'), { status: 429 })), /limiting requests/);
  assert.match(describeAnalysisError(Object.assign(new Error('x'), { status: 504 })), /did not answer/);
  assert.equal(describeAnalysisError(Object.assign(new Error('Analysis cancelled.'), { name: 'AbortError' })), null);
  assert.equal(describeAnalysisError(new Error('Something specific')), 'Something specific');
});

test('recognises memory failures and gives the paste-a-transcript advice', () => {
  assert.equal(isOutOfMemory(new RangeError('Array buffer allocation failed')), true);
  assert.equal(isOutOfMemory(new Error('model file not found')), false);
  assert.match(speechFailureMessage(new RangeError('Array buffer allocation failed')), /ran out of memory/);
  assert.match(speechFailureMessage(new Error('no network')), /Paste a transcript/);
});

test('a real silent video is reported as having no sound track', async () => {
  const silent = new Uint8Array(await readFile(new URL('./fixtures/silent-video.mp4', import.meta.url)));
  assert.equal(mp4AudioTrack(silent), 'absent');
  const file = new File([silent], 'silent.mp4', { type: 'video/mp4' });
  assert.equal(await detectAudioTrack(file, { chunkBytes: 4096 }), 'absent');
});

import { pictureLooksBlank, BLANK_PICTURE_LUMA } from '../src/analysis/mediaCheck.js';
test('a clip whose scanned frames are all near-black is flagged as not decoded', () => {
  assert.equal(pictureLooksBlank([1, 1, 2, 1]), true);
  assert.equal(pictureLooksBlank([1, 120, 2]), false, 'one bright frame means the picture decoded');
  assert.equal(pictureLooksBlank([]), false);
  assert.ok(BLANK_PICTURE_LUMA > 2 && BLANK_PICTURE_LUMA < 40);
});
