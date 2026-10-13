// Behavioural test for the extension's tab-capture pipeline (background.js + offscreen.js).
//
// Chrome is not available in this environment, so the chrome.* APIs are stubbed.
// This checks message routing, state transitions, the token header, and error
// handling. It does NOT prove that Chrome grants tab capture; that still needs a
// real browser run (see extension/README.md).

import test from 'node:test';
import assert from 'node:assert/strict';

const sessionStore = {};
const localStore = { 'rp.apiToken': 'tok-123' };
const listeners = [];
let offscreenOpen = false;
let streamIdRequests = [];
let failGetUserMedia = false;
let recorders = [];
let fetchCalls = [];
let fetchResponse = { status: 200, body: { similarity: 0.42, currentDurationSeconds: 14.9 } };

const pick = (store, key) => (key === undefined ? { ...store } : { [key]: store[key] });

function dispatch(message) {
  return new Promise((resolve, reject) => {
    if (message.target === 'offscreen' && !offscreenOpen) {
      reject(new Error('Could not establish connection. Receiving end does not exist.'));
      return;
    }
    let keepOpen = false;
    for (const listener of listeners) {
      if (listener(message, {}, resolve) === true) keepOpen = true;
    }
    if (!keepOpen) resolve(undefined);
  });
}

globalThis.chrome = {
  storage: {
    session: {
      get: async key => pick(sessionStore, key),
      set: async obj => { Object.assign(sessionStore, obj); },
    },
    local: {
      get: async key => pick(localStore, key),
      set: async obj => { Object.assign(localStore, obj); },
    },
    onChanged: { addListener() {} },
  },
  runtime: {
    onMessage: { addListener: fn => listeners.push(fn) },
    onStartup: { addListener() {} },
    getURL: path => `chrome-extension://test-id/${path}`,
    getContexts: async () => (offscreenOpen ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []),
    sendMessage: message => dispatch(message),
  },
  tabs: { query: async () => [{ id: 7, title: 'Demo video' }] },
  tabCapture: {
    getMediaStreamId: async ({ targetTabId }) => {
      streamIdRequests.push(targetTabId);
      return 'stream-123';
    },
  },
  offscreen: {
    createDocument: async () => { offscreenOpen = true; },
    closeDocument: async () => { offscreenOpen = false; },
  },
};

globalThis.navigator = {
  mediaDevices: {
    getUserMedia: async constraints => {
      if (failGetUserMedia) throw new Error('NotAllowedError');
      globalThis.lastConstraints = constraints;
      return {
        getAudioTracks: () => [{ stop() {} }],
        getTracks: () => [{ stop() {} }],
      };
    },
  },
};

globalThis.AudioContext = class {
  constructor() { this.state = 'running'; this.destination = {}; }
  createMediaStreamSource() { return { connect() {} }; }
  async close() { this.state = 'closed'; }
};

globalThis.MediaRecorder = class {
  static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
  constructor(stream, options = {}) {
    this.state = 'inactive';
    this.mimeType = options.mimeType || 'audio/webm';
    recorders.push(this);
  }
  start() {
    this.state = 'recording';
    // Simulate ~2 KB of recorded audio on the first chunk.
    queueMicrotask(() => this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)], { type: this.mimeType }) }));
  }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.());
  }
};

globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init });
  return {
    ok: fetchResponse.status < 400,
    status: fetchResponse.status,
    json: async () => fetchResponse.body,
  };
};

// Load the real modules after the stubs exist.
await import('../extension/background.js');
await import('../extension/offscreen.js');

const reference = { algorithm: 'Chromaprint', fingerprint: 'AQAAA-fingerprint', durationSeconds: 14.9 };
const flush = () => new Promise(resolve => setTimeout(resolve, 20));

function reset() {
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  offscreenOpen = false;
  streamIdRequests = [];
  failGetUserMedia = false;
  recorders = [];
  fetchCalls = [];
  fetchResponse = { status: 200, body: { similarity: 0.42, currentDurationSeconds: 14.9 } };
  localStore['rp.apiToken'] = 'tok-123';
}

test('start opens an offscreen recorder for the active tab and records state', async () => {
  reset();
  const response = await dispatch({ target: 'background', type: 'rp:start', seconds: 15, reference });
  assert.equal(response.ok, true);
  assert.deepEqual(streamIdRequests, [7]);
  assert.equal(offscreenOpen, true);
  assert.equal(sessionStore.rpCapture.status, 'recording');
  assert.equal(sessionStore.rpCapture.seconds, 15);
  assert.equal(globalThis.lastConstraints.audio.mandatory.chromeMediaSourceId, 'stream-123');
  await dispatch({ target: 'background', type: 'rp:stop' });
  await flush();
});

test('stop completes the capture, stores the score, sends the token, and closes the recorder', async () => {
  reset();
  await dispatch({ target: 'background', type: 'rp:start', seconds: 30, reference });
  const stop = await dispatch({ target: 'background', type: 'rp:stop' });
  assert.equal(stop.ok, true);
  await flush();
  assert.equal(sessionStore.rpCapture.status, 'done');
  assert.equal(sessionStore.rpCapture.similarity, 0.42);
  assert.equal(offscreenOpen, false);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'http://127.0.0.1:8000/api/fingerprint/compare');
  assert.equal(fetchCalls[0].init.headers.Authorization, 'Bearer tok-123');
  const body = fetchCalls[0].init.body;
  assert.equal(body.get('reference_fingerprint'), 'AQAAA-fingerprint');
  assert.equal(body.get('reference_duration'), '14.9');
});

test('no token configured means no Authorization header', async () => {
  reset();
  localStore['rp.apiToken'] = '';
  await dispatch({ target: 'background', type: 'rp:start', seconds: 15, reference });
  await dispatch({ target: 'background', type: 'rp:stop' });
  await flush();
  assert.equal(sessionStore.rpCapture.status, 'done');
  assert.deepEqual(fetchCalls[0].init.headers, {});
});

test('a second start while recording is refused', async () => {
  reset();
  await dispatch({ target: 'background', type: 'rp:start', seconds: 15, reference });
  const second = await dispatch({ target: 'background', type: 'rp:start', seconds: 15, reference });
  assert.equal(second.ok, false);
  assert.match(second.error, /already running/);
  await dispatch({ target: 'background', type: 'rp:stop' });
  await flush();
});

test('a permission failure becomes an error state, not a stuck recording', async () => {
  reset();
  failGetUserMedia = true;
  const response = await dispatch({ target: 'background', type: 'rp:start', seconds: 15, reference });
  assert.equal(response.ok, true); // start was accepted; the failure arrives asynchronously
  await flush();
  assert.equal(sessionStore.rpCapture.status, 'error');
  assert.match(sessionStore.rpCapture.error, /tab audio stream/);
  assert.equal(offscreenOpen, false);
});

test('a backend rejection is reported as an error with its detail', async () => {
  reset();
  fetchResponse = { status: 401, body: { detail: 'Missing or invalid RelayProof API token.' } };
  await dispatch({ target: 'background', type: 'rp:start', seconds: 15, reference });
  await dispatch({ target: 'background', type: 'rp:stop' });
  await flush();
  assert.equal(sessionStore.rpCapture.status, 'error');
  assert.equal(sessionStore.rpCapture.error, 'Missing or invalid RelayProof API token.');
});

test('start without a Chromaprint reference is refused before any capture', async () => {
  reset();
  const response = await dispatch({ target: 'background', type: 'rp:start', seconds: 15, reference: { algorithm: 'other' } });
  assert.equal(response.ok, false);
  assert.equal(streamIdRequests.length, 0);
  assert.equal(offscreenOpen, false);
});

test('an unsupported length is refused', async () => {
  reset();
  const response = await dispatch({ target: 'background', type: 'rp:start', seconds: 999, reference });
  assert.equal(response.ok, false);
  assert.match(response.error, /15, 30, or 60/);
});
