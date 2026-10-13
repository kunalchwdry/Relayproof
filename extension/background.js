// RelayProof background service worker (Manifest V3).
//
// Owns the tab-capture lifecycle. Chrome does not allow chrome.tabCapture.capture
// to keep recording once the popup closes, so this worker:
//   1. obtains a tab-capture stream ID from the user's click (activeTab),
//   2. hands it to an offscreen document, which records and does the comparison,
//   3. stores the outcome in chrome.storage.session so the popup can show it later.
// Recording therefore continues if the popup loses focus or is closed.

const API_BASE = 'http://127.0.0.1:8000';
const OFFSCREEN_URL = 'offscreen.html';
const STATE_KEY = 'rpCapture';
const TOKEN_KEY = 'rp.apiToken';
const ALLOWED_SECONDS = [15, 30, 60];
// A recording that has run longer than its length plus this grace period is stale
// (for example, the browser restarted mid-capture) and may be replaced.
const STALE_GRACE_MS = 90 * 1000;

async function getState() {
  const stored = await chrome.storage.session.get(STATE_KEY);
  return stored[STATE_KEY] || { status: 'idle' };
}

async function setState(state) {
  await chrome.storage.session.set({ [STATE_KEY]: { ...state, updatedAt: Date.now() } });
}

function isBusy(state) {
  if (state.status === 'processing') return true;
  if (state.status !== 'recording') return false;
  const expiresAt = (state.startedAt || 0) + (state.seconds || 0) * 1000 + STALE_GRACE_MS;
  return Date.now() < expiresAt;
}

async function getToken() {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  return typeof stored[TOKEN_KEY] === 'string' ? stored[TOKEN_KEY].trim() : '';
}

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Record the active tab audio that the user explicitly asked RelayProof to check.',
  });
}

async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument();
}

// The offscreen document may still be starting when the first message is sent,
// so retry briefly until its listener is registered.
async function sendToOffscreen(message) {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error('The offscreen recorder did not start.');
}

async function startCapture({ seconds, reference }) {
  const state = await getState();
  if (isBusy(state)) throw new Error('A tab capture is already running. Wait for it to finish.');
  if (!ALLOWED_SECONDS.includes(Number(seconds))) throw new Error('Choose a 15, 30, or 60 second capture.');
  if (!reference?.fingerprint || reference.algorithm !== 'Chromaprint') {
    throw new Error('Load a signature-valid sidecar that contains a Chromaprint reference first.');
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab was found.');

  // Requires the user's gesture on the extension (the popup button click).
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await ensureOffscreenDocument();
  await setState({
    status: 'recording',
    seconds: Number(seconds),
    startedAt: Date.now(),
    tabTitle: (tab.title || 'active tab').slice(0, 120),
  });
  try {
    await sendToOffscreen({
      type: 'rp:start',
      streamId,
      seconds: Number(seconds),
      reference: {
        fingerprint: reference.fingerprint,
        durationSeconds: Number(reference.durationSeconds),
      },
      apiBase: API_BASE,
      token: await getToken(),
    });
  } catch (error) {
    await setState({ status: 'error', error: error instanceof Error ? error.message : 'Recording could not start.' });
    await closeOffscreenDocument();
    throw error;
  }
}

async function stopCapture() {
  const state = await getState();
  if (state.status !== 'recording') throw new Error('No tab capture is running.');
  try {
    await sendToOffscreen({ type: 'rp:stop' });
  } catch (error) {
    // The recorder is gone; surface that instead of leaving the UI stuck.
    await setState({ status: 'error', error: 'The recorder stopped unexpectedly. Start a new capture.' });
    await closeOffscreenDocument();
    throw error;
  }
}

async function finishCapture(message) {
  if (message.ok) {
    const state = await getState();
    await setState({
      status: 'done',
      seconds: state.seconds,
      similarity: message.similarity,
      currentDurationSeconds: message.currentDurationSeconds,
      tabTitle: state.tabTitle,
    });
  } else {
    await setState({ status: 'error', error: message.error || 'The capture could not be compared.' });
  }
  await closeOffscreenDocument();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'background') return false;

  if (message.type === 'rp:start') {
    startCapture(message)
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Capture failed.' }));
    return true; // Keep the channel open for the async response.
  }

  if (message.type === 'rp:stop') {
    stopCapture()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Stop failed.' }));
    return true;
  }

  if (message.type === 'rp:capture-finished') {
    // Sent by the offscreen document once it has a result or an error.
    finishCapture(message).catch(() => {});
    return false;
  }

  return false;
});

// A browser restart clears recording state; never resume a stale capture.
chrome.runtime.onStartup.addListener(() => {
  setState({ status: 'idle' }).catch(() => {});
});
