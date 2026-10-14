import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { formatBytes } from '../data.js';
import { runSebiPreflight, SEBI_REFERENCE_LINKS } from '../sebiPreflight.js';

const MAX_MEDIA_BYTES = 500 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_VIDEO_FRAME_SAMPLES = 24;
const MAX_FRAME_BYTES = 3 * 1024 * 1024;
// Cloud (NVIDIA NIM) OCR sends JSON, so frames are smaller and fewer to fit the free host's request limit.
const NIM_FRAME_SAMPLES = 8;
const NIM_MAX_SIDE = 960;
const MAX_NIM_FRAME_BYTES = 480 * 1024;
const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('Could not encode a sampled frame.'));
  reader.readAsDataURL(blob);
});
const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)$/i;
const isVideoMedia = file => Boolean(file && (file.type?.startsWith('video/') || VIDEO_EXTENSION.test(file.name || '')));

function formatTimestamp(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function seekVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.03 && !video.seeking) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error('Timed out while seeking to a video frame.')), 8000);
    const finish = error => {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      error ? reject(error) : resolve();
    };
    const onSeeked = () => finish();
    const onError = () => finish(new Error('The browser could not decode a requested video frame.'));
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    try { video.currentTime = time; } catch (error) { finish(error); }
  });
}

const ROLE_LABELS = {
  unknown: 'Unknown / review all areas',
  'registered-ra': 'SEBI-registered RA (self-declared)',
  'registered-ia': 'SEBI-registered IA (self-declared)',
  'regulated-entity': 'Other regulated entity (self-declared)',
  issuer: 'Issuer / public-issue communicator (self-declared)',
  educator: 'Investor educator / creator (self-declared)',
};

function cleanSubtitleText(raw) {
  return raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(line => !/^\s*\d+\s*$/.test(line))
    .filter(line => !/^\s*(?:WEBVTT|NOTE|STYLE)\s*$/i.test(line))
    .filter(line => !/^\s*\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+/.test(line))
    .map(line => line.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function MediaPreview({ media, url, onRemove, videoRef }) {
  if (!media) {
    return (
      <div className="content-media-empty">
        <span className="content-media-icon"><Icon name="upload" size={19} /></span>
        <strong>Add a video or audio file</strong>
        <span>Preview stays in this browser. Start the optional local Whisper service to create a transcript.</span>
      </div>
    );
  }
  const isVideo = media.type.startsWith('video/') || (!media.type.startsWith('audio/') && /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(media.name));
  return (
    <div className="content-media-card">
      <div className="content-media-title"><span><strong>{media.name}</strong><small>{formatBytes(media.size)} · {isVideo ? 'video' : 'audio'} · selected locally</small></span><button className="text-button" type="button" onClick={onRemove}>Remove</button></div>
      {isVideo ? <video ref={videoRef} className="content-media-player" src={url} controls playsInline preload="metadata" /> : <audio className="content-audio-player" src={url} controls />}
      <div className="content-media-hint">Optional OCR samples at most 24 frames for English text. It does not inspect every frame, measure disclosure duration, or verify edits.</div>
    </div>
  );
}

function FlagCard({ flag }) {
  return (
    <article className={`preflight-flag ${flag.severity === 'high' ? 'high' : ''}`}>
      <div className="preflight-flag-top"><span className="preflight-flag-area">{flag.area}</span><span className={`preflight-severity ${flag.severity}`}>{flag.severity === 'high' ? 'HIGH ATTENTION' : 'REVIEW'}</span></div>
      <h4>{flag.title}</h4>
      <p>{flag.detail}</p>
      {flag.examples?.map((example, index) => <blockquote key={`${flag.id}-${index}`}>“{example}”</blockquote>)}
    </article>
  );
}

export default function ContentReviewView({ notify }) {
  const mediaInput = useRef(null);
  const transcriptInput = useRef(null);
  const videoRef = useRef(null);
  const mediaUrlRef = useRef(null);
  const transcribeAbortRef = useRef(null);
  const frameScanAbortRef = useRef(null);
  const frameOcrSequence = useRef(0);
  const [media, setMedia] = useState(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [publisherRole, setPublisherRole] = useState('unknown');
  const [sourceRefs, setSourceRefs] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [mediaError, setMediaError] = useState('');
  const [asrStatus, setAsrStatus] = useState('checking');
  const [asrModel, setAsrModel] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptionNote, setTranscriptionNote] = useState('');
  const [frameOcrStatus, setFrameOcrStatus] = useState('checking');
  const [frameOcrMessage, setFrameOcrMessage] = useState('Checking local Tesseract OCR…');
  const [frameScanning, setFrameScanning] = useState(false);
  const [frameOcrResults, setFrameOcrResults] = useState([]);
  const [frameOcrText, setFrameOcrText] = useState('');
  const [frameOcrNote, setFrameOcrNote] = useState('');
  const [frameOcrError, setFrameOcrError] = useState('');
  const [ocrProvider, setOcrProvider] = useState('local');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Local transcription service is not running.')))
      .then(data => {
        setAsrStatus('ready');
        setAsrModel(data.model || 'Whisper');
        setFrameOcrStatus(data.frameOcrAvailable ? 'ready' : 'offline');
        setFrameOcrMessage(data.frameOcrAvailable ? 'Local English OCR ready.' : (data.frameOcrMessage || 'Local OCR is not configured.'));
      })
      .catch(() => fetch('/api/nim/status', { signal: controller.signal })
        .then(response => response.ok ? response.json() : Promise.reject(new Error('NIM status unavailable.')))
        .then(nim => {
          setOcrProvider('nim');
          setAsrStatus('offline');
          setFrameOcrStatus(nim.frameOcrAvailable ? 'ready' : 'offline');
          setFrameOcrMessage(nim.frameOcrAvailable ? 'NVIDIA NIM vision OCR is ready (cloud, English).' : 'NVIDIA NIM is not configured on this server; manual frame review still works.');
        })
        .catch(() => {
          setAsrStatus('offline');
          setFrameOcrStatus('offline');
          setFrameOcrMessage('No OCR service is reachable; manual frame review still works.');
        }));
    return () => controller.abort();
  }, []);

  useEffect(() => () => {
    transcribeAbortRef.current?.abort();
    frameScanAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    frameScanAbortRef.current = null;
    frameOcrSequence.current += 1;
    if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current);
  }, []);

  function chooseMedia(file) {
    if (!file) return;
    const valid = file.type?.startsWith('audio/') || file.type?.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg|opus|ogg|m4a|mp3|wav|aac|flac|aiff|aif)$/i.test(file.name || '');
    if (!valid) {
      setMediaError('Choose an audio or video file.');
      notify('Choose an audio or video file.');
      return;
    }
    if (file.size > MAX_MEDIA_BYTES) {
      setMediaError('This browser preview supports media files up to 500 MB.');
      notify('This browser preview supports media files up to 500 MB.');
      return;
    }
    transcribeAbortRef.current?.abort();
    frameScanAbortRef.current?.abort();
    frameOcrSequence.current += 1;
    transcribeAbortRef.current = null;
    frameScanAbortRef.current = null;
    setTranscribing(false);
    setFrameScanning(false);
    setFrameOcrResults([]);
    setFrameOcrText('');
    setFrameOcrNote('');
    setFrameOcrError('');
    if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    mediaUrlRef.current = nextUrl;
    setMedia(file);
    setMediaUrl(nextUrl);
    setMediaError('');
    setTranscript('');
    setTranscriptionNote('');
    setAnalysis(null);
  }

  function removeMedia() {
    transcribeAbortRef.current?.abort();
    frameScanAbortRef.current?.abort();
    frameOcrSequence.current += 1;
    transcribeAbortRef.current = null;
    frameScanAbortRef.current = null;
    setTranscribing(false);
    setFrameScanning(false);
    setFrameOcrResults([]);
    setFrameOcrText('');
    setFrameOcrNote('');
    setFrameOcrError('');
    if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current);
    mediaUrlRef.current = null;
    setMediaUrl('');
    setMedia(null);
    setAnalysis(null);
  }

  async function loadTranscript(file) {
    if (!file) return;
    if (file.size > MAX_TRANSCRIPT_BYTES) {
      notify('Transcript/subtitle files must be 2 MB or smaller.');
      return;
    }
    const raw = await file.text();
    setTranscript(cleanSubtitleText(raw));
    setTranscriptionNote(`Imported captions from ${file.name}; review recognition and timing manually.`);
    setAnalysis(null);
    notify('Transcript loaded. Review it against the audio/video before scanning.');
  }

  async function transcribeMedia() {
    if (!media) {
      notify('Choose an audio or video file first.');
      return;
    }
    if (asrStatus !== 'ready') {
      notify('Start the optional self-hosted Whisper service using the instructions in LIVE_VERIFIER.md.');
      return;
    }
    setTranscribing(true);
    setMediaError('');
    const controller = new AbortController();
    transcribeAbortRef.current = controller;
    try {
      const formData = new FormData();
      formData.append('file', media, media.name);
      const response = await fetch('/api/transcribe', { method: 'POST', body: formData, signal: controller.signal });
      let payload = {};
      try { payload = await response.json(); } catch { /* Keep a readable fallback below. */ }
      if (!response.ok) throw new Error(payload.detail || `Transcription service returned HTTP ${response.status}.`);
      if (!payload.text?.trim()) throw new Error('No speech transcript was returned. You can import captions or paste text instead.');
      setTranscript(payload.text);
      setTranscriptionNote(`Local ${payload.model || 'Whisper'} transcription · language ${payload.language || 'unknown'} · review/correct names, numbers and tickers.`);
      setAnalysis(null);
      notify('Local transcript created. Please review it against the clip before running the pre-check.');
    } catch (error) {
      if (error?.name !== 'AbortError') {
        const message = error instanceof Error ? error.message : 'Local transcription failed.';
        setMediaError(message);
        notify(message);
      }
    } finally {
      if (transcribeAbortRef.current === controller) {
        transcribeAbortRef.current = null;
        setTranscribing(false);
      }
    }
  }

  async function scanVideoFrames() {
    const useNim = ocrProvider === 'nim';
    if (useNim && frameOcrStatus === 'ready' && !window.confirm('Send up to 8 sampled still frames from this video to NVIDIA NIM to read on-screen text? Only the stills are sent, never the full video.')) return;
    const video = videoRef.current;
    if (!media || !isVideoMedia(media) || !video) {
      notify('Select a video first.');
      return;
    }
    if (frameOcrStatus !== 'ready') {
      notify('Start the local Tesseract OCR service described in LIVE_VERIFIER.md.');
      return;
    }
    const token = ++frameOcrSequence.current;
    const controller = new AbortController();
    frameScanAbortRef.current?.abort();
    frameScanAbortRef.current = controller;
    setFrameScanning(true);
    setFrameOcrError('');
    setFrameOcrNote('Sampling frames across the video in your browser…');
    setFrameOcrResults([]);
    setFrameOcrText('');
    const wasPaused = video.paused;
    const originalTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    try {
      if (video.readyState < 1) {
        await new Promise((resolve, reject) => {
          const timer = window.setTimeout(() => finish(new Error('Timed out loading video metadata.')), 10000);
          const finish = error => {
            window.clearTimeout(timer);
            video.removeEventListener('loadedmetadata', onLoaded);
            video.removeEventListener('error', onError);
            error ? reject(error) : resolve();
          };
          const onLoaded = () => finish();
          const onError = () => finish(new Error('The browser could not read this video.'));
          video.addEventListener('loadedmetadata', onLoaded, { once: true });
          video.addEventListener('error', onError, { once: true });
        });
      }
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('This video has no readable duration.');
      if (!video.videoWidth || !video.videoHeight) throw new Error('Video frames are not available for local sampling.');
      const count = Math.min(useNim ? NIM_FRAME_SAMPLES : MAX_VIDEO_FRAME_SAMPLES, Math.max(3, Math.ceil(duration / 20) + 1));
      const lastTime = Math.max(0, duration - 0.12);
      const timestamps = Array.from({ length: count }, (_, index) => count === 1 ? lastTime / 2 : lastTime * index / (count - 1));
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, (useNim ? NIM_MAX_SIDE : 1280) / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Browser canvas is unavailable for frame sampling.');
      video.pause();
      const body = new FormData();
      const nimFrames = [];
      const capturedTimestamps = [];
      for (let index = 0; index < timestamps.length; index += 1) {
        if (token !== frameOcrSequence.current) return;
        const timestamp = timestamps[index];
        await seekVideo(video, timestamp);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72));
        if (!frame) throw new Error('Could not capture a video frame.');
        if (frame.size > MAX_FRAME_BYTES) throw new Error('A sampled frame exceeds the 3 MB size limit.');
        if (useNim) {
          if (frame.size > MAX_NIM_FRAME_BYTES) throw new Error('A sampled frame is too large for cloud OCR. Try a shorter clip.');
          nimFrames.push({ timestampSeconds: Number(timestamp.toFixed(3)), dataUrl: await blobToDataUrl(frame) });
        } else {
          body.append('frames', frame, `frame-${String(index + 1).padStart(2, '0')}.jpg`);
        }
        capturedTimestamps.push(Number(timestamp.toFixed(3)));
      }
      body.append('timestamps', JSON.stringify(capturedTimestamps));
      setFrameOcrNote(`Sending ${capturedTimestamps.length} sampled still frames to ${useNim ? 'NVIDIA NIM (cloud)' : 'your local OCR service'}…`);
      let response;
      try {
        response = useNim
          ? await fetch('/api/nim/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frames: nimFrames }), signal: controller.signal })
          : await fetch('/api/ocr/frames', { method: 'POST', body, signal: controller.signal });
      } catch {
        throw new Error('The local OCR backend is offline. Start it on your own computer before sending any sampled frames.');
      }
      let payload = {};
      try { payload = await response.json(); } catch { /* The local proxy may be offline. */ }
      if (!response.ok) throw new Error(payload.detail || `Frame OCR returned HTTP ${response.status}.`);
      if (token !== frameOcrSequence.current) return;
      const results = Array.isArray(payload.frames) ? payload.frames : [];
      const visualText = results.filter(frame => frame.text?.trim())
        .map(frame => `[${formatTimestamp(frame.timestampSeconds)}] ${frame.text.trim()}`).join('\n');
      setFrameOcrResults(results);
      setFrameOcrText(visualText);
      setFrameOcrNote(`${results.length} evenly spaced frames sampled across ${formatTimestamp(duration)}. English OCR only; check the timestamped text against the actual frames.`);
      setAnalysis(null);
      notify(`Sampled ${results.length} video frames. Review OCR text and playback before scanning.`);
    } catch (error) {
      if (error?.name !== 'AbortError' && token === frameOcrSequence.current) {
        const message = error instanceof Error ? error.message : 'Video frame OCR failed.';
        setFrameOcrError(message);
        setFrameOcrNote('No frame OCR result was produced.');
        notify(message);
      }
    } finally {
      try {
        if (video.isConnected && Number.isFinite(video.duration)) await seekVideo(video, Math.min(originalTime, Math.max(0, video.duration - 0.12)));
        if (!wasPaused && video.isConnected) await video.play();
      } catch { /* Restoring playback is best effort. */ }
      if (frameScanAbortRef.current === controller) frameScanAbortRef.current = null;
      if (token === frameOcrSequence.current) setFrameScanning(false);
    }
  }

  function jumpToFrame(timestamp) {
    const video = videoRef.current;
    if (!video) return;
    seekVideo(video, timestamp).then(() => video.play()).catch(() => notify('Could not jump to that frame; use the video controls to review manually.'));
  }

  function runCheck() {
    const cleanFrameText = frameOcrText.trim().replace(/^\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]\s*/gm, '');
    const textToCheck = [transcript.trim(), cleanFrameText].filter(Boolean).join('\n');
    if (!textToCheck) {
      notify('Add a transcript or run local video-frame OCR before scanning.');
      return;
    }
    const result = {
      ...runSebiPreflight(textToCheck, { publisherRole }),
      transcriptIncluded: Boolean(transcript.trim()),
      frameOcrIncluded: Boolean(frameOcrText.trim()),
      sampledFrameCount: frameOcrResults.length,
    };
    setAnalysis(result);
    notify(result.flags.length ? `${result.flags.length} possible review flag${result.flags.length === 1 ? '' : 's'} found.` : 'No obvious phrase-level flags found; this is not approval or fact verification.');
  }

  const clearCheck = () => setAnalysis(null);

  return (
    <section className="view active" aria-label="SEBI content preflight for audio and video">
      <div className="page-intro"><div className="section-kicker">CONTENT REVIEW &nbsp;·&nbsp; 04</div><h1>Review what the clip says.</h1><p>Load video or audio, review the transcript, and optionally scan sampled video frames for on-screen English text. The limited first-pass phrase scan flags issues for a human reviewer; it never certifies a clip as compliant.</p></div>
      <div className="preflight-notice"><span className="preflight-notice-icon"><Icon name="warning" size={16} /></span><div><strong>No automatic “SEBI-approved” verdict</strong><p>Rules depend on whether content is education, security-specific research/advice, a promotion, or a public-issue communication—and on the speaker’s role. This is a preliminary screening aid, not legal advice or regulatory clearance.</p></div></div>
      <div className="content-review-grid">
        <div className="content-review-left">
          <article className="panel content-media-panel">
            <div className="panel-head"><div><div className="micro-label">01 · LOCAL MEDIA</div><h2 className="panel-title" style={{ marginTop: 7 }}>Audio or video input</h2><p className="panel-subtitle">Playback is local; pressing Transcribe sends the file to the configured local service.</p></div><span className="local-tag">MAX 500 MB</span></div>
            <input ref={mediaInput} className="hidden-file" type="file" accept="audio/*,video/*,.opus,.ogg,.m4a,.mp3,.wav,.aac,.flac,.aiff,.aif,.mp4,.mov,.m4v,.webm,.mkv,.avi,.mpeg,.mpg" onChange={event => { chooseMedia(event.target.files[0]); event.target.value = ''; }} />
            <MediaPreview media={media} url={mediaUrl} onRemove={removeMedia} videoRef={videoRef} />
            {!media && <button type="button" className="btn-outline content-media-choose" onClick={() => mediaInput.current?.click()}>Choose video or audio</button>}
            <div className={`asr-service-status ${asrStatus}`}><span className="asr-status-dot" />{asrStatus === 'ready' ? `Local Whisper service ready · model ${asrModel}.` : asrStatus === 'checking' ? 'Checking the optional local Whisper service…' : 'Speech-to-text runs only on your own computer (local Whisper). Captions or a pasted transcript still work.'}</div>
            {media && isVideoMedia(media) && <>
              <div className={`asr-service-status ${frameOcrStatus}`}><span className="asr-status-dot" />{frameOcrStatus === 'ready' ? (ocrProvider === 'nim' ? 'NVIDIA NIM vision OCR ready · only the sampled stills are sent, and only after you click.' : 'Local English video-frame OCR ready · sampling stays in your browser.') : frameOcrStatus === 'checking' ? 'Checking the optional local Tesseract OCR service…' : frameOcrMessage}</div>
              <div className="frame-ocr-actions"><button type="button" className="btn-outline" onClick={scanVideoFrames} disabled={frameScanning || frameOcrStatus !== 'ready'}>{frameScanning ? 'Sampling + scanning frames…' : 'Sample frames + read on-screen text'}</button><span className="form-footnote">Up to 24 evenly spaced stills · English OCR · reviewer must check</span></div>
              {frameOcrNote && <div className="transcript-source-note">{frameOcrNote}</div>}
              {frameOcrError && <div className="inline-error" role="alert">{frameOcrError}</div>}
              {frameOcrResults.length > 0 && <div className="frame-ocr-list" aria-label="Timestamped frame OCR results">{frameOcrResults.map(frame => <div className="frame-ocr-row" key={`frame-${frame.index}`}><button type="button" className="frame-time-button" onClick={() => jumpToFrame(frame.timestampSeconds)}>{formatTimestamp(frame.timestampSeconds)} ↗</button><span>{frame.text || (frame.error ? 'OCR failed for this frame.' : 'No readable English text detected.')}</span>{frame.meanOcrConfidence != null && <small>OCR confidence {frame.meanOcrConfidence}%</small>}</div>)}</div>}
            </>}
            <div className="transcription-privacy"><Icon name="shield" size={13} /><span>{ocrProvider === 'nim' ? 'Cloud OCR (NVIDIA NIM): when you click the scan button, up to 8 sampled still frames are sent to NVIDIA to read text. The full video is not uploaded. Do not use confidential clips with cloud OCR.' : 'Transcription sends the full selected media file to the configured local API. Frame OCR extracts stills in this browser and sends only those sampled images after you click the button. Run these services on your own computer for private media; the shared preview is not for confidential clips.'}</span></div>
            {mediaError && <div className="inline-error" role="alert">{mediaError}</div>}
          </article>
          <article className="panel transcript-panel">
            <div className="panel-head"><div><div className="micro-label">02 · TRANSCRIPT</div><h2 className="panel-title" style={{ marginTop: 7 }}>Check the spoken words</h2><p className="panel-subtitle">Use local Whisper when running, or paste/import captions. Review transcription errors before scanning.</p></div><div className="transcript-tools"><button type="button" className="btn-outline" onClick={transcribeMedia} disabled={!media || transcribing || asrStatus !== 'ready'} title={asrStatus === 'ready' ? 'Transcribe with the configured local service' : 'Start the optional local Whisper service first'}>{transcribing ? 'Transcribing…' : 'Transcribe media'}</button><button type="button" className="btn-outline" onClick={() => transcriptInput.current?.click()}>Import .srt / .vtt / .txt</button></div></div>
            <input ref={transcriptInput} className="hidden-file" type="file" accept=".srt,.vtt,.txt,text/plain,text/vtt" onChange={event => { loadTranscript(event.target.files[0]).catch(() => notify('Could not read that transcript file.')); event.target.value = ''; }} />
            <div className="field"><label htmlFor="publisherRole">Publisher / speaker context (if known)</label><select id="publisherRole" value={publisherRole} onChange={event => { setPublisherRole(event.target.value); setAnalysis(null); }}><option value="unknown">Unknown / review all areas</option><option value="registered-ra">SEBI-registered Research Analyst (RA)</option><option value="registered-ia">SEBI-registered Investment Adviser (IA)</option><option value="regulated-entity">Other SEBI-regulated entity / intermediary</option><option value="issuer">Issuer / public-issue communicator</option><option value="educator">Investor educator / creator</option></select></div>
            <div className="field transcript-field"><label htmlFor="transcript">Transcript / captions to scan</label><textarea id="transcript" rows="12" value={transcript} onChange={event => { setTranscript(event.target.value); setTranscriptionNote('Transcript edited by reviewer; confirm it against the audio/video.'); setAnalysis(null); }} placeholder="Paste the words spoken in the video or audio. Include important on-screen text separately if relevant; this scan only reviews the text you provide." /></div>
            <div className="transcript-meta"><span>{transcript.trim() ? `${transcript.trim().split(/\s+/).length.toLocaleString()} words · text scan` : 'No transcript loaded'}</span><span>Transcript truthfulness and completeness are not checked.</span></div>
            {transcriptionNote && <div className="transcript-source-note">{transcriptionNote}</div>}
            <div className="field frame-ocr-text-field"><label htmlFor="frameOcrText">On-screen text / timestamped OCR (optional)</label><textarea id="frameOcrText" rows="6" value={frameOcrText} onChange={event => { setFrameOcrText(event.target.value); setAnalysis(null); }} placeholder="Use the video panel to sample frames, review the OCR text, or enter visible disclaimers and disclosures manually." /><span className="source-ref-note">OCR is sampled English text, not a full visual review. Verify wording, timing, legibility, and required duration in the actual video.</span></div>
            <div className="field source-refs-field"><label htmlFor="sourceRefs">Official sources already checked (optional)</label><textarea id="sourceRefs" rows="2" value={sourceRefs} onChange={event => setSourceRefs(event.target.value)} placeholder="Paste URLs to SEBI circulars, exchange filings, official offer documents, or company disclosures." /></div>
            <div className="source-ref-note">Adding a link records your review note only; this version does not fetch or validate the linked source.</div>
            <div className="form-actions"><button type="button" className="btn-primary" onClick={runCheck}><Icon name="search" size={14} /> Scan transcript + visual text</button><span className="form-footnote">English phrase heuristics · OCR and transcript can be wrong · no rule verdict</span></div>
          </article>
        </div>
        <aside className="panel preflight-results" aria-live="polite">
          <div className="panel-head"><div><div className="micro-label">03 · REVIEW REPORT</div><h2 className="panel-title" style={{ marginTop: 7 }}>Preliminary findings</h2><p className="panel-subtitle">No verdict is a substitute for compliance review.</p></div>{analysis && <button type="button" className="text-button" onClick={clearCheck}>Clear</button>}</div>
          {!analysis ? <div className="preflight-empty"><span className="preflight-empty-icon"><Icon name="info" size={18} /></span><strong>Ready when spoken or on-screen text is provided</strong><span>Import/paste captions, use local Whisper, or sample timestamped video frames for English OCR. OCR samples do not replace human review of the full clip.</span></div> : (
            <>
              <div className={`preflight-status ${analysis.flags.length ? 'has-flags' : 'no-flags'}`}><span className="preflight-status-dot" /><div><strong>{analysis.flags.length ? 'Human review required' : 'No obvious phrase-level flags'}</strong><span>{analysis.flags.length ? `${analysis.flags.length} heuristic flag${analysis.flags.length === 1 ? '' : 's'} · not a finding of violation` : 'This is not a compliance pass or approval.'}</span></div></div>
              <div className="report-check-row"><span>Text phrase scan inputs</span><strong>{analysis.transcriptIncluded && analysis.frameOcrIncluded ? 'Transcript + OCR' : analysis.transcriptIncluded ? 'Transcript only' : 'OCR text only'}</strong></div>
              <div className="report-check-row"><span>Timestamped frames sampled</span><strong className={analysis.sampledFrameCount ? '' : 'report-unchecked'}>{analysis.sampledFrameCount ? `${analysis.sampledFrameCount} samples` : 'No'}</strong></div>
              <div className="report-check-row"><span>Claims checked against primary sources</span><strong className="report-unchecked">No</strong></div>
              <div className="report-check-row"><span>SEBI registration verified</span><strong className="report-unchecked">No</strong></div>
              <div className="report-check-row"><span>Visual/on-screen disclosures manually reviewed</span><strong className="report-unchecked">No</strong></div>
              <div className="report-check-row"><span>Publisher role (self-declared)</span><strong className="report-unchecked">{ROLE_LABELS[analysis.publisherRole] || 'Unknown'}</strong></div>
              <div className="report-check-row"><span>Risk-related word detected</span><strong>{analysis.checks.riskLanguageMentioned ? 'Yes · context not assessed' : 'No · not assessed'}</strong></div>
              <div className="report-check-row"><span>Registration-related word detected</span><strong>{analysis.checks.registrationLanguageMentioned ? 'Yes · status not verified' : 'No · not verified'}</strong></div>
              {analysis.flags.length > 0 && <div className="preflight-flags-list">{analysis.flags.map(flag => <FlagCard key={flag.id} flag={flag} />)}</div>}
              <div className="evidence-section"><h3>Claims needing a source check</h3>{analysis.claimsNeedingEvidence.length ? <ul className="evidence-list">{analysis.claimsNeedingEvidence.map((claim, index) => <li key={`claim-${index}`}><span className="unverified-pill">UNVERIFIED</span><span>{claim}</span></li>)}</ul> : <p>No numeric/date items matched the simple extractor. Other factual statements are still unverified.</p>}</div>
              {sourceRefs.trim() && <div className="source-recorded"><Icon name="link" size={12} /> Source links noted by reviewer; not fetched or validated.</div>}
              <div className="manual-review-list"><h3>Before publication, a qualified reviewer should</h3><ul><li>Verify every factual claim against dated SEBI, exchange, issuer, or offer-document sources.</li><li>Check the speaker’s identity, SEBI registration status, and applicable role-specific disclosures.</li><li>Review all frames, on-screen text, logos, captions, edits, endorsements, and paid relationships.</li><li>Apply the correct rule set for the content, audience, publisher, and publication date.</li></ul></div>
            </>
          )}
        </aside>
      </div>
      <div className="lower-grid content-reference-grid">
        <article className="trail-panel panel"><div className="trail-head"><div><div className="section-kicker">REFERENCE STARTING POINTS</div><h3 className="trail-title">Official materials to review</h3><div className="trail-sub">Selected public sources; not an exhaustive rule library.</div></div><span className="local-tag">SEBI SOURCES</span></div><div className="sebi-links">{SEBI_REFERENCE_LINKS.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}<span>↗</span></a>)}</div></article>
        <article className="caveat-panel panel"><div className="caveat-icon"><Icon name="shield" size={15} /></div><h3>Separate three different questions.</h3><p><strong>Provenance:</strong> who signed a source claim. <strong>Facts:</strong> whether statements match reliable, dated evidence. <strong>Compliance:</strong> whether the content and publisher satisfy the rules applicable to that context. This page only provides a limited text pre-screen for the third and a list of claims to verify for the second.</p></article>
      </div>
      <div className="footer-note"><span>RelayProof · SEBI content preflight</span><span>Screening aid only · not legal advice, fact certification, or SEBI approval</span></div>
    </section>
  );
}
