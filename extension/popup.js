import { verifyCredentialSignature, isRelayProofCredential } from './credential.js';

const API_BASE = 'http://127.0.0.1:8000';
const EXACT_HASH_LIMIT = 128 * 1024 * 1024;
const MAX_COMPARE_FILE = 500 * 1024 * 1024;
const STATE_KEY = 'rpCapture';
const TOKEN_KEY = 'rp.apiToken';
const STALE_GRACE_MS = 90 * 1000;

const sidecarInput = document.getElementById('sidecar-input');
const mediaInput = document.getElementById('media-input');
const sidecarName = document.getElementById('sidecar-name');
const sidecarStatus = document.getElementById('sidecar-status');
const mediaName = document.getElementById('media-name');
const serviceStatus = document.getElementById('service-status');
const compareFileButton = document.getElementById('compare-file');
const startCaptureButton = document.getElementById('start-capture');
const stopCaptureButton = document.getElementById('stop-capture');
const captureDuration = document.getElementById('capture-duration');
const apiTokenInput = document.getElementById('api-token');
const saveTokenButton = document.getElementById('save-token');
const resultBox = document.getElementById('result');

let credential = null;
let selectedMedia = null;
let chromaprintReady = false;
let lastHealthMessage = 'Local RelayProof media service is offline.';
let apiToken = '';
let captureState = { status: 'idle' };

function apiHeaders() {
  return apiToken ? { Authorization: `Bearer ${apiToken}` } : {};
}

function showResult({ title, score = '', note, error = false }) {
  resultBox.hidden = false;
  resultBox.classList.toggle('error', error);
  resultBox.replaceChildren();
  const kicker = document.createElement('div');
  kicker.className = 'result-kicker';
  kicker.textContent = error ? 'CHECK COULD NOT COMPLETE' : 'LOCAL CHECK';
  const heading = document.createElement('h3');
  heading.textContent = title;
  resultBox.append(kicker, heading);
  if (score !== '') {
    const scoreNode = document.createElement('div');
    scoreNode.className = 'score';
    scoreNode.textContent = score;
    resultBox.append(scoreNode);
  }
  const message = document.createElement('p');
  message.textContent = note;
  resultBox.append(message);
}

function isCaptureRunning(state) {
  if (state.status === 'processing') return true;
  if (state.status !== 'recording') return false;
  const expiresAt = (state.startedAt || 0) + (state.seconds || 0) * 1000 + STALE_GRACE_MS;
  return Date.now() < expiresAt;
}

function updateButtons() {
  const hasCredential = Boolean(credential);
  compareFileButton.disabled = !hasCredential || !selectedMedia;
  const hasFingerprint = Boolean(credential?.audioFingerprint?.fingerprint && credential.audioFingerprint.algorithm === 'Chromaprint');
  startCaptureButton.disabled = !chromaprintReady || !hasFingerprint || isCaptureRunning(captureState);
  stopCaptureButton.disabled = captureState.status !== 'recording' || !isCaptureRunning(captureState);
}

function setServiceStatus(message, state = 'checking') {
  serviceStatus.className = `service-status ${state}`;
  serviceStatus.querySelector('span').textContent = message;
}

async function checkService() {
  try {
    const response = await fetch(`${API_BASE}/api/health`, { headers: apiHeaders() });
    const health = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw new Error('The local service requires an API token. Paste the token from RELAYPROOF_API_TOKEN below and save it.');
    }
    if (response.status === 403) {
      throw new Error('The local service rejected this extension. Set RELAYPROOF_EXTENSION_ID to this extension’s ID and restart the backend.');
    }
    if (!response.ok) throw new Error(health.detail || `Local service returned HTTP ${response.status}.`);
    chromaprintReady = Boolean(health.chromaprintAvailable);
    if (chromaprintReady) {
      lastHealthMessage = 'Local Chromaprint service ready.';
      setServiceStatus('Local Chromaprint ready · no AcoustID web lookup.', 'ready');
    } else {
      lastHealthMessage = health.chromaprintMessage || 'Native Chromaprint is not configured.';
      setServiceStatus(`Local service is running, but Chromaprint is unavailable: ${lastHealthMessage}`, 'offline');
    }
  } catch (error) {
    chromaprintReady = false;
    lastHealthMessage = error instanceof Error && error.message.startsWith('The local service')
      ? error.message
      : 'Could not reach the local service. Check the backend, port 8000, and the extension setup.';
    setServiceStatus(lastHealthMessage, 'offline');
  }
  updateButtons();
}

async function loadSidecar(file) {
  credential = null;
  sidecarStatus.className = 'sidecar-status';
  if (!file) {
    sidecarName.textContent = 'No sidecar selected';
    sidecarStatus.textContent = 'A valid signature is required before comparison.';
    updateButtons();
    return;
  }
  sidecarName.textContent = file.name;
  sidecarStatus.textContent = 'Checking signature…';
  updateButtons();
  try {
    if (file.size > 1024 * 1024) throw new Error('Sidecar must be 1 MB or smaller.');
    const parsed = JSON.parse(await file.text());
    if (!isRelayProofCredential(parsed)) throw new Error('This is not a supported RelayProof sidecar.');
    const verification = await verifyCredentialSignature(parsed);
    if (!verification.valid) throw new Error(verification.reason || 'Signature check failed.');
    credential = parsed;
    const hasFingerprint = Boolean(parsed.audioFingerprint?.algorithm === 'Chromaprint' && parsed.audioFingerprint?.fingerprint);
    sidecarStatus.className = 'sidecar-status valid';
    sidecarStatus.textContent = hasFingerprint
      ? `Signature valid · Chromaprint audio reference attached · ${parsed.issuer?.name || 'publisher key is self-asserted'}.`
      : `Signature valid · no Chromaprint reference · ${parsed.issuer?.name || 'publisher key is self-asserted'}.`;
    if (!hasFingerprint) {
      sidecarStatus.textContent += ' Exact local-file SHA can still be checked; YouTube/tab matching needs a fingerprint sidecar.';
    }
  } catch (error) {
    sidecarStatus.className = 'sidecar-status invalid';
    sidecarStatus.textContent = error instanceof Error ? error.message : 'Could not load sidecar.';
  }
  updateButtons();
}

async function sha256Hex(file) {
  if (file.size > EXACT_HASH_LIMIT) throw new Error('Exact SHA-256 check in the extension is limited to 128 MB.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function compareWithFingerprint(file, reference, sourceLabel) {
  if (!reference?.fingerprint || reference.algorithm !== 'Chromaprint') {
    throw new Error('This signed sidecar does not contain a Chromaprint reference. Re-issue it with the optional fingerprint enabled.');
  }
  if (file.size > MAX_COMPARE_FILE) throw new Error('Comparison input must be 500 MB or smaller.');
  const body = new FormData();
  body.append('file', file, file.name || 'captured-audio.webm');
  body.append('reference_fingerprint', reference.fingerprint);
  body.append('reference_duration', String(reference.durationSeconds));
  const response = await fetch(`${API_BASE}/api/fingerprint/compare`, { method: 'POST', body, headers: apiHeaders() });
  let payload = {};
  try { payload = await response.json(); } catch { /* Explain the proxy/service failure below. */ }
  if (!response.ok) throw new Error(payload.detail || `Local Chromaprint service returned HTTP ${response.status}.`);
  const similarity = Number(payload.similarity);
  if (!Number.isFinite(similarity) || similarity < 0 || similarity > 1) throw new Error('Local service returned an invalid score.');
  showCandidateScore(similarity, sourceLabel);
}

function showCandidateScore(similarity, sourceLabel) {
  showResult({
    title: 'Candidate audio similarity',
    score: `${(similarity * 100).toFixed(1)}%`,
    note: `${sourceLabel}. This score is uncalibrated and is not a “same source”, authenticity, AI-detection, or truth verdict. A captured YouTube tab is a new recording, not the original source bytes.`,
  });
}

async function checkSelectedFile() {
  const currentCredential = credential;
  const file = selectedMedia;
  if (!currentCredential || !file) return;
  compareFileButton.disabled = true;
  showResult({ title: 'Checking sidecar and selected file…', note: 'Exact SHA-256 is calculated locally in this extension.' });
  try {
    const signature = await verifyCredentialSignature(currentCredential);
    if (!signature.valid) throw new Error('Sidecar signature must verify before the media is checked.');
    let digestMatches = false;
    let hashMessage = 'File is larger than the extension exact-hash limit; continuing to candidate comparison if available.';
    if (file.size <= EXACT_HASH_LIMIT) {
      const digest = await sha256Hex(file);
      digestMatches = digest === currentCredential.asset.sha256;
      hashMessage = digestMatches ? 'Exact SHA-256 matches the signed media bytes.' : 'Exact SHA-256 differs from the signed media bytes.';
    }
    if (digestMatches) {
      showResult({ title: 'Exact file match', score: 'SHA-256 match', note: 'The selected file bytes match this signed sidecar. This does not independently establish the publisher’s real-world identity or the truth of the claim.' });
      return;
    }
    if (!currentCredential.audioFingerprint?.fingerprint) {
      showResult({ title: 'No exact match', note: `${hashMessage} This sidecar has no Chromaprint reference, so a derivative candidate comparison is not available.` });
      return;
    }
    showResult({ title: 'Exact bytes differ · comparing audio…', note: `${hashMessage} Sending the selected media to your configured local backend for an audio-only candidate score.` });
    await compareWithFingerprint(file, currentCredential.audioFingerprint, file.name);
  } catch (error) {
    showResult({ title: 'Could not check this file', note: error instanceof Error ? error.message : 'Local verification failed.', error: true });
  } finally {
    updateButtons();
  }
}

// --- Tab capture: the popup only starts/stops; background.js + offscreen.js record. ---

function renderCaptureState(state) {
  captureState = state || { status: 'idle' };
  if (captureState.status === 'recording') {
    if (isCaptureRunning(captureState)) {
      setServiceStatus(`Recording current-tab audio · ${captureState.seconds}s. Recording continues if you close this popup.`, 'checking');
    } else {
      setServiceStatus('The previous capture did not finish. Start a new capture when ready.', 'offline');
    }
  } else if (captureState.status === 'processing') {
    setServiceStatus('Comparing the captured audio locally…', 'checking');
  } else if (captureState.status === 'done') {
    setServiceStatus('Local capture finished.', 'ready');
    showCandidateScore(Number(captureState.similarity), `Captured ${captureState.seconds} seconds from ${captureState.tabTitle || 'the active tab'}`);
  } else if (captureState.status === 'error') {
    setServiceStatus('Capture stopped.', 'offline');
    showResult({ title: 'Tab capture did not complete', note: captureState.error || 'The capture failed.', error: true });
  }
  updateButtons();
}

async function loadCaptureState() {
  const stored = await chrome.storage.session.get(STATE_KEY);
  renderCaptureState(stored[STATE_KEY]);
}

async function startTabCapture() {
  const reference = credential?.audioFingerprint;
  if (!credential || !reference?.fingerprint) {
    showResult({ title: 'Fingerprint reference required', note: 'Load a signature-valid sidecar containing a Chromaprint reference first.', error: true });
    return;
  }
  if (!chromaprintReady) {
    showResult({ title: 'Local service unavailable', note: lastHealthMessage, error: true });
    return;
  }
  startCaptureButton.disabled = true;
  setServiceStatus('Starting capture from the active tab…', 'checking');
  let response;
  try {
    response = await chrome.runtime.sendMessage({
      target: 'background',
      type: 'rp:start',
      seconds: Number(captureDuration.value) || 30,
      reference: {
        algorithm: reference.algorithm,
        fingerprint: reference.fingerprint,
        durationSeconds: reference.durationSeconds,
      },
    });
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : 'The extension background is unavailable.' };
  }
  if (!response?.ok) {
    showResult({ title: 'Tab capture unavailable', note: response?.error || 'Chrome could not capture this tab.', error: true });
    setServiceStatus('Capture not started.', 'offline');
  }
  await loadCaptureState();
}

async function stopTabCapture() {
  stopCaptureButton.disabled = true;
  let response;
  try {
    response = await chrome.runtime.sendMessage({ target: 'background', type: 'rp:stop' });
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : 'The extension background is unavailable.' };
  }
  if (!response?.ok) {
    showResult({ title: 'Could not stop the capture', note: response?.error || 'Stop failed.', error: true });
  }
  await loadCaptureState();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[STATE_KEY]) {
    renderCaptureState(changes[STATE_KEY].newValue);
  }
});

// --- Optional local API token (see server RELAYPROOF_API_TOKEN). ---

async function loadToken() {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  apiToken = typeof stored[TOKEN_KEY] === 'string' ? stored[TOKEN_KEY].trim() : '';
  apiTokenInput.value = apiToken;
}

async function saveToken() {
  apiToken = apiTokenInput.value.trim();
  await chrome.storage.local.set({ [TOKEN_KEY]: apiToken });
  setServiceStatus('Token saved in this browser profile. Checking the local service…', 'checking');
  await checkService();
}

sidecarInput.addEventListener('change', () => loadSidecar(sidecarInput.files?.[0]));
mediaInput.addEventListener('change', () => {
  selectedMedia = mediaInput.files?.[0] || null;
  mediaName.textContent = selectedMedia ? `${selectedMedia.name} · ${(selectedMedia.size / 1024 / 1024).toFixed(2)} MB` : 'No media selected';
  resultBox.hidden = true;
  updateButtons();
});
compareFileButton.addEventListener('click', checkSelectedFile);
startCaptureButton.addEventListener('click', startTabCapture);
stopCaptureButton.addEventListener('click', stopTabCapture);
saveTokenButton.addEventListener('click', saveToken);

await loadToken();
await checkService();
await loadCaptureState();
updateButtons();
