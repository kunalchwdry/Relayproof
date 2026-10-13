// Offscreen recorder for RelayProof tab capture.
//
// Offscreen documents can use only chrome.runtime, so this file reports results
// back to background.js, which writes them to chrome.storage.session. It records
// the tab's audio for the requested length, routes it back to the speakers (so the
// tab is not silenced), then sends the clip to the local Chromaprint comparison.

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const MIN_CLIP_BYTES = 1000;

let session = null;

chrome.runtime.onMessage.addListener(message => {
  if (message?.target !== 'offscreen') return false;
  if (message.type === 'rp:start') {
    startRecording(message).catch(error => report(false, describe(error)));
  } else if (message.type === 'rp:stop') {
    stopRecording();
  }
  return false;
});

function describe(error) {
  return error instanceof Error ? error.message : 'Capture failed.';
}

function report(ok, payload) {
  const message = ok
    ? { target: 'background', type: 'rp:capture-finished', ok: true, ...payload }
    : { target: 'background', type: 'rp:capture-finished', ok: false, error: payload };
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function startRecording({ streamId, seconds, reference, apiBase, token }) {
  if (session) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false,
    });
  } catch (error) {
    throw new Error(`Chrome could not open the tab audio stream. ${describe(error)}`);
  }
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach(track => track.stop());
    throw new Error('The active tab produced no audio track. Start the audio and try again.');
  }

  const audioContext = new AudioContext();
  // Without this, capturing a tab mutes it. Routing the stream back keeps playback audible.
  audioContext.createMediaStreamSource(stream).connect(audioContext.destination);

  const mimeType = MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported(type));
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const current = {
    stream,
    audioContext,
    recorder,
    chunks: [],
    seconds,
    reference,
    apiBase,
    token,
    timer: null,
  };
  session = current;

  recorder.ondataavailable = event => {
    if (event.data?.size) current.chunks.push(event.data);
  };
  recorder.onerror = () => {
    finalize(current, 'The browser recorder stopped unexpectedly. Check that tab audio is playing and try again.');
  };
  recorder.onstop = () => {
    finalize(current);
  };

  recorder.start(500);
  current.timer = setTimeout(stopRecording, seconds * 1000);
}

function stopRecording() {
  if (!session) return;
  clearTimeout(session.timer);
  session.timer = null;
  if (session.recorder.state !== 'inactive') {
    session.recorder.stop(); // onstop -> finalize
  } else {
    finalize(session);
  }
}

async function releaseResources(current) {
  current.stream.getTracks().forEach(track => track.stop());
  if (current.audioContext.state !== 'closed') {
    try { await current.audioContext.close(); } catch { /* Best-effort cleanup. */ }
  }
}

async function finalize(current, recorderError = '') {
  if (session !== current) return; // Already finalized.
  session = null;
  await releaseResources(current);
  if (recorderError) {
    report(false, recorderError);
    return;
  }

  const blob = new Blob(current.chunks, { type: current.recorder.mimeType || 'audio/webm' });
  if (blob.size < MIN_CLIP_BYTES) {
    report(false, 'The clip was silent or too short. Make sure the active tab is playing audio, then try again.');
    return;
  }
  const extension = blob.type.includes('mp4') ? '.m4a' : blob.type.includes('ogg') ? '.ogg' : '.webm';
  const clip = new File([blob], `relayproof-tab-capture${extension}`, { type: blob.type });

  try {
    const result = await compareClip(clip, current);
    report(true, result);
  } catch (error) {
    report(false, describe(error));
  }
}

async function compareClip(clip, { reference, apiBase, token }) {
  const body = new FormData();
  body.append('file', clip, clip.name);
  body.append('reference_fingerprint', reference.fingerprint);
  body.append('reference_duration', String(reference.durationSeconds));
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${apiBase}/api/fingerprint/compare`, { method: 'POST', body, headers });
  let payload = {};
  try { payload = await response.json(); } catch { /* Explain the failure below. */ }
  if (!response.ok) {
    throw new Error(payload.detail || `Local Chromaprint service returned HTTP ${response.status}.`);
  }
  const similarity = Number(payload.similarity);
  if (!Number.isFinite(similarity) || similarity < 0 || similarity > 1) {
    throw new Error('Local service returned an invalid score.');
  }
  return {
    similarity,
    currentDurationSeconds: Number(payload.currentDurationSeconds) || null,
  };
}
