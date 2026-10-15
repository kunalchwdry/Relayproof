import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { buildFindings, formatTime } from '../analysis/findings.js';
import { parseCaptions } from '../analysis/captions.js';
import { chooseSampleTimes, frameDifference } from '../analysis/sampling.js';
import { postJson } from '../analysis/request.js';
import { checkProvenance } from '../analysis/provenance.js';
import { REVERSE_IMAGE_SEARCHES, frameFileName } from '../analysis/reverseSearch.js';
import { decodeAudio, transcribeAudio, MAX_SPEECH_SECONDS, SPEECH_MODEL } from '../analysis/transcribe.js';
import { detectAudioTrack, describeAnalysisError, speechFailureMessage, ANALYSIS_LIMITS, pictureLooksBlank, BLANK_PICTURE_MESSAGE } from '../analysis/mediaCheck.js';
import { buildReport, reportFileName } from '../analysis/report.js';

const MAX_VIDEO_BYTES = ANALYSIS_LIMITS.maxVideoMb * 1024 * 1024;
const MAX_CLIP_SECONDS = ANALYSIS_LIMITS.maxClipMinutes * 60;
const MAX_SAMPLES = 16;
const MAX_SCAN = 180; // thumbnails compared per clip, at most
const BATCH = 4;
const MAX_FRAME_BYTES = 480 * 1024;
const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)$/i;

function seekTo(video, time) {
  return new Promise(resolve => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = time;
    window.setTimeout(done, 4000);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not encode a frame.'));
    reader.readAsDataURL(blob);
  });
}

async function captureFrame(video, canvas, context, time) {
  await seekTo(video, time);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.7, 0.5]) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not capture a video frame.');
    if (blob.size <= MAX_FRAME_BYTES) return blobToDataUrl(blob);
  }
  throw new Error('A frame is too large to send. Try a lower-resolution clip.');
}

// Keyboard rules: focus moves into the pop-up when it opens, Tab and Shift+Tab stay inside it, Escape closes it,
// and focus goes back to the control that opened it.
function AlertPopup({ alerts, onJump, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    const focusable = () => Array.from(dialog.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')).filter(el => !el.disabled);
    const first = focusable()[0];
    (first || dialog).focus();

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) { event.preventDefault(); dialog.focus(); return; }
      const head = items[0];
      const tail = items[items.length - 1];
      const inside = dialog.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === head)) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === tail)) {
        event.preventDefault();
        head.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // If the opener is gone or disabled (the Analyse button is disabled while a run is going), use the page heading.
      const usable = opener && opener !== document.body && document.contains(opener) && !opener.disabled && typeof opener.focus === 'function';
      (usable ? opener : document.getElementById('analyze-title'))?.focus();
    };
  }, []);

  return (
    <div className="alert-overlay" role="presentation">
      <div ref={dialogRef} tabIndex={-1} className="alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="alert-title" aria-describedby="alert-desc">
        <div className="alert-head">
          <span className="alert-icon"><Icon name="shield" size={18} /></span>
          <div>
            <div className="section-kicker">HIGH-PRIORITY FINDINGS</div>
            <h3 id="alert-title">{alerts.length} thing{alerts.length === 1 ? '' : 's'} need your attention</h3>
            <p id="alert-desc">These are leads from the frames and text. Check each one against the clip before acting.</p>
          </div>
        </div>
        <ul className="alert-list">
          {alerts.map((alert, index) => (
            <li key={`${alert.title}-${index}`} className={`alert-item ${alert.severity}`}>
              <div>
                <strong>{alert.title}</strong>
                {alert.at != null && <span className="alert-time">at {formatTime(alert.at)}</span>}
                <p>{alert.description}</p>
              </div>
              {alert.at != null && <button type="button" className="btn-outline" onClick={() => onJump(alert.at)}>Jump to frame</button>}
            </li>
          ))}
        </ul>
        <div className="alert-foot">
          <button type="button" className="btn-glow" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}

export default function AnalyzeView({ notify }) {
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [useSpeech, setUseSpeech] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const videoRef = useRef(null);
  const fileInput = useRef(null);
  const captionInput = useRef(null);
  const runId = useRef(0);
  const pickRef = useRef(0);
  const [audioTrack, setAudioTrack] = useState(null);
  const [playbackError, setPlaybackError] = useState('');
  const abortRef = useRef(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const busy = ['provenance', 'sampling', 'frames', 'speech', 'text'].includes(phase);
  const findings = useMemo(() => (result ? buildFindings(result.frames, result.text) : null), [result]);

  function chooseVideo(next) {
    if (!next) return;
    if (!next.type?.startsWith('video/') && !VIDEO_EXTENSION.test(next.name || '')) {
      notify('Choose a video file.');
      return;
    }
    if (next.size > MAX_VIDEO_BYTES) {
      notify('Videos must be 500 MB or smaller.');
      return;
    }
    if (url) URL.revokeObjectURL(url);
    setUrl(URL.createObjectURL(next));
    setFile(next);
    setDuration(0);
    setResult(null);
    setError('');
    setPlaybackError('');
    setPhase('idle');
    setAudioTrack(null);
    const pick = ++pickRef.current;
    detectAudioTrack(next).then(track => { if (pick === pickRef.current) setAudioTrack(track); }).catch(() => {});
  }

  async function loadCaptions(next) {
    if (!next) return;
    if (next.size > 2 * 1024 * 1024) { notify('Caption files must be 2 MB or smaller.'); return; }
    setTranscript(parseCaptions(await next.text()));
    notify('Captions loaded. Review them before analysing.');
  }

  async function analyse() {
    const video = videoRef.current;
    if (!video || !file) return;
    const token = ++runId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // A run is stale once it is cancelled or a newer run has started. Stale runs stop and keep nothing.
    const stale = () => token !== runId.current || controller.signal.aborted;
    setError('');
    setResult(null);
    setPopupOpen(false);
    try {
      if (playbackError) throw new Error(playbackError);
      if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('This video has no readable duration. The format may not be supported in this browser.');
      const length = video.duration;
      if (length > MAX_CLIP_SECONDS) throw new Error(`This clip is longer than ${ANALYSIS_LIMITS.maxClipMinutes} minutes. Trim it and try again.`);
      // Reads Content Credentials in this browser. The file is not uploaded; the check never throws.
      setPhase('provenance');
      setProgress('Reading Content Credentials (C2PA) in this browser. The file is not uploaded.');
      const credentials = await checkProvenance(file);
      if (stale()) return;
      const count = Math.min(MAX_SAMPLES, Math.max(3, Math.ceil(length / 8) + 1));

      // Scan the clip with small thumbnails and keep the moments where the picture changes most, plus even coverage.
      // Only the chosen moments are captured at full size and sent for analysis.
      const scanStep = Math.max(2, length / MAX_SCAN);
      const scanTimes = [];
      for (let t = 0.1; t < length - 0.2; t += scanStep) scanTimes.push(Number(t.toFixed(2)));
      const thumb = document.createElement('canvas');
      thumb.width = 48;
      thumb.height = Math.max(1, Math.round((48 * (video.videoHeight || 540)) / (video.videoWidth || 960)));
      const thumbContext = thumb.getContext('2d', { willReadFrequently: true });
      const candidates = [];
      const meanLumas = [];
      let previous = null;
      setPhase('sampling');
      for (let i = 0; i < scanTimes.length; i += 1) {
        if (stale()) return;
        setProgress(`Scanning the clip for scene changes: ${i + 1} of ${scanTimes.length}`);
        await seekTo(video, scanTimes[i]);
        thumbContext.drawImage(video, 0, 0, thumb.width, thumb.height);
        const pixels = thumbContext.getImageData(0, 0, thumb.width, thumb.height).data;
        const gray = new Uint8Array(thumb.width * thumb.height);
        let lumaSum = 0;
        for (let p = 0, g = 0; p < pixels.length; p += 4, g += 1) {
          gray[g] = (pixels[p] * 299 + pixels[p + 1] * 587 + pixels[p + 2] * 114) / 1000;
          lumaSum += gray[g];
        }
        meanLumas.push(lumaSum / gray.length);
        candidates.push({ time: scanTimes[i], diff: previous ? frameDifference(previous, gray) : 0 });
        previous = gray;
      }
      // Stop before any frame is captured or sent if the browser cannot show the picture.
      if (pictureLooksBlank(meanLumas)) throw new Error(BLANK_PICTURE_MESSAGE);
      let times = chooseSampleTimes(candidates, count, length).map(t => Math.max(0.1, Math.min(length - 0.2, t)));
      if (times.length === 0) times = [0.1];
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 960 / Math.max(video.videoWidth || 960, video.videoHeight || 540));
      canvas.width = Math.max(1, Math.round((video.videoWidth || 960) * scale));
      canvas.height = Math.max(1, Math.round((video.videoHeight || 540) * scale));
      const context = canvas.getContext('2d', { alpha: false });
      video.pause();

      setPhase('sampling');
      const frames = [];
      for (let i = 0; i < times.length; i += 1) {
        if (stale()) return;
        setProgress(`Playing through the clip: capturing frame ${i + 1} of ${times.length} at ${formatTime(times[i])}`);
        const dataUrl = await captureFrame(video, canvas, context, times[i]);
        frames.push({ timestampSeconds: Number(times[i].toFixed(2)), dataUrl });
      }

      setPhase('frames');
      const analysed = [];
      for (let start = 0; start < frames.length; start += BATCH) {
        if (stale()) return;
        const batch = frames.slice(start, start + BATCH);
        setProgress(`Checking frames for illegal content, scams, and visual problems (${Math.min(start + BATCH, frames.length)} of ${frames.length})`);
        const payload = await postJson('/api/nim/analyze-frames', { frames: batch }, { signal: controller.signal });
        analysed.push(...(payload.frames || []));
      }

      const onScreen = analysed.filter(frame => frame.onScreenText).map(frame => `[${formatTime(frame.timestampSeconds)}] ${frame.onScreenText}`).join('\n');
      // Typed or uploaded transcript wins. Otherwise transcribe the audio in this browser (nothing is uploaded for this step).
      let spoken = transcript.trim();
      let speech = null;
      let speechError = '';
      let speechNotice = '';
      if (!spoken && useSpeech) {
        setPhase('speech');
        try {
          if (audioTrack === 'absent') {
            speechNotice = 'This clip has no sound track, so there were no spoken words to check.';
          } else {
            const audio = await decodeAudio(file);
            if (stale()) return;
            if (audio.failed) {
              speechError = 'This browser could not read the audio in this file (the format may not be supported). Paste a transcript instead.';
            } else if (audio.seconds === 0) {
              speechNotice = 'This clip has no sound track, so there were no spoken words to check.';
            } else if (audio.seconds > MAX_SPEECH_SECONDS) {
              speechError = `The clip is longer than ${ANALYSIS_LIMITS.speechMinutes} minutes, so its speech was not transcribed. Paste a transcript instead.`;
            } else {
              const transcribed = await transcribeAudio(audio.samples, { onStatus: message => { if (!stale()) setProgress(message); } });
              if (stale()) return;
              spoken = transcribed.text;
              speech = transcribed.segments;
            }
          }
        } catch (err) {
          if (stale()) return;
          speechError = speechFailureMessage(err);
        }
      }

      let text = null;
      if (spoken || onScreen) {
        setPhase('text');
        setProgress('Checking the words for scams, unsafe content, and factual or logical problems');
        text = await postJson('/api/nim/analyze-text', { transcript: spoken, onScreenText: onScreen }, { signal: controller.signal });
      }
      if (stale()) return;

      // Keep each frame's picture next to its findings, so the user can download it and run a reverse-image search.
      const pictureAt = new Map(frames.map(frame => [frame.timestampSeconds, frame.dataUrl]));
      const framesWithText = analysed.map(frame => ({ ...frame, dataUrl: pictureAt.get(frame.timestampSeconds) || null }));
      const transcriptSource = transcript.trim() ? 'typed' : speech ? 'speech' : null;
      const nextResult = { frames: framesWithText, text, transcriptProvided: Boolean(spoken), transcriptSource, speech, speechError, speechNotice, duration: length, provenance: credentials, audioTrack };
      setResult(nextResult);
      const built = buildFindings(framesWithText, text);
      setPhase('done');
      setProgress('');
      if (built.alerts.length) setPopupOpen(true);
      notify(built.alerts.length ? `${built.alerts.length} high-priority finding(s).` : 'Analysis finished. No high-priority findings.');
    } catch (err) {
      if (stale()) return;
      const message = describeAnalysisError(err);
      if (message === null) return;
      setPhase('error');
      setProgress('');
      setError(message);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  // Downloads the findings as JSON. Frame pictures are not included.
  function exportReport() {
    if (!result) return;
    const generatedAt = new Date().toISOString();
    const report = buildReport({ clipName: file?.name, clipBytes: file?.size, result, findings, generatedAt });
    const href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = reportFileName(file?.name, generatedAt);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    notify('Report downloaded.');
  }

  // Stops the run at its next step: frame capture, each NVIDIA call, and the wait between retries.
  // The in-browser speech model cannot be interrupted once it has started; its result is then discarded.
  function cancel() {
    if (!abortRef.current) return;
    abortRef.current.abort();
    runId.current += 1;
    setPhase('idle');
    setProgress('');
    setError('');
    notify('Analysis cancelled. Nothing was kept.');
  }

  function jump(time) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, time);
    video.play().catch(() => {});
    setPopupOpen(false);
  }

  const marks = findings?.timelineMarks || [];

  return (
    <section className="view active analyze-view" aria-labelledby="analyze-title">
      <div className="section-heading">
        <div>
          <div className="section-kicker">VIDEO ANALYSIS</div>
          <h2 id="analyze-title" tabIndex={-1}>Play a clip and check what it shows and says.</h2>
          <p>The clip is stepped through frame by frame in your browser. Frames go to NVIDIA NIM for reading and safety checks. Speech is transcribed in your browser when you tick the box, or you can paste a transcript. Limits: 500 MB and 60 minutes.</p>
        </div>
      </div>

      <div className="analyze-grid">
        <article className="panel analyze-player-panel">
          {!file ? (
            <button type="button" className="analyze-drop" onClick={() => fileInput.current?.click()}>
              <Icon name="check" size={22} />
              <strong>Choose a video</strong>
              <span>MP4, WebM, MOV, MKV · up to 500 MB and 60 minutes · stays in this browser until you analyse</span>
            </button>
          ) : (
            <video
              ref={videoRef}
              className="analyze-video"
              src={url}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={event => setDuration(event.currentTarget.duration)}
              onError={() => setPlaybackError('This browser cannot play this video. The format or codec may not be supported (H.265/HEVC often is not). Convert it to MP4 with H.264 video and try again.')}
            />
          )}
          <input ref={fileInput} type="file" accept="video/*,.mp4,.webm,.mov,.mkv,.m4v" className="hidden-file" onChange={event => { chooseVideo(event.target.files[0]); event.target.value = ''; }} />
          {file && (
            <div className="analyze-meta">
              <span>{file.name}</span>
              <span>{duration ? formatTime(duration) : 'loading…'}</span>
              <button type="button" className="text-button" onClick={() => fileInput.current?.click()}>Change</button>
            </div>
          )}
          {marks.length > 0 && duration > 0 && (
            <div className="analyze-timeline" aria-label="Timeline of findings">
              {marks.map((mark, index) => (
                <button
                  key={`${mark.at}-${index}`}
                  type="button"
                  className={`timeline-mark ${mark.severity}`}
                  style={{ left: `${Math.min(100, (mark.at / duration) * 100)}%` }}
                  title={`${formatTime(mark.at)} · ${mark.title}`}
                  onClick={() => jump(mark.at)}
                  aria-label={`${formatTime(mark.at)} ${mark.title}`}
                />
              ))}
            </div>
          )}
        </article>

        <article className="panel analyze-side-panel">
          <div className="section-kicker">SPOKEN WORDS</div>
          <label className="analyze-speech-toggle">
            <input type="checkbox" checked={useSpeech} onChange={event => setUseSpeech(event.target.checked)} disabled={Boolean(transcript.trim())} />
            <span>Transcribe the speech in this browser (downloads about 41 MB the first time, English only)</span>
          </label>
          {duration > ANALYSIS_LIMITS.longSpeechHintMinutes * 60 && useSpeech && (
            <p className="analyze-hint">This clip is over {ANALYSIS_LIMITS.longSpeechHintMinutes} minutes. On a laptop with 8 GB of memory or less, transcribing it can run out of memory. If that happens, paste a transcript.</p>
          )}
          {audioTrack === 'absent' && <p className="analyze-hint">This clip has no sound track.</p>}
          <p className="analyze-hint">Or paste a transcript, or upload captions (.srt, .vtt, .txt). Typed text always wins over the browser transcript.</p>
          <textarea
            className="analyze-transcript"
            rows={7}
            value={transcript}
            onChange={event => setTranscript(event.target.value)}
            placeholder="Paste what is said in the clip…"
            aria-label="Transcript"
          />
          <div className="analyze-caption-actions">
            <button type="button" className="btn-outline" onClick={() => captionInput.current?.click()}>Upload captions</button>
            {transcript && <button type="button" className="text-button" onClick={() => setTranscript('')}>Clear</button>}
          </div>
          <input ref={captionInput} type="file" accept=".srt,.vtt,.txt" className="hidden-file" onChange={event => { loadCaptions(event.target.files[0]); event.target.value = ''; }} />

          {playbackError && <div className="inline-error" role="alert">{playbackError}</div>}
          {duration > MAX_CLIP_SECONDS && <div className="inline-error" role="alert">This clip is longer than {ANALYSIS_LIMITS.maxClipMinutes} minutes. Trim it to analyse it.</div>}
          <button type="button" className="btn-glow analyze-run" onClick={analyse} disabled={!file || busy || !duration || Boolean(playbackError) || duration > MAX_CLIP_SECONDS}>
            {busy ? 'Analysing…' : 'Analyse this clip'}
          </button>
          {busy && <button type="button" className="btn-outline analyze-cancel" onClick={cancel}>Cancel analysis</button>}
          {busy && <div className="analyze-progress" role="status">{progress}</div>}
          {error && <div className="inline-error" role="alert">{error}</div>}
          <p className="analyze-privacy">Sent to NVIDIA NIM: up to 16 downscaled still frames and the text above. The full video is not uploaded. Do not use confidential clips.</p>
        </article>
      </div>

      {findings && (
        <div className="analyze-results">
          <div className="analyze-summary">
            <div><strong>{findings.summary.framesAnalysed}</strong><span>frames checked</span></div>
            <div className={findings.summary.highAlerts ? 'bad' : ''}><strong>{findings.summary.highAlerts}</strong><span>high-priority</span></div>
            <div><strong>{findings.summary.claimsChecked}</strong><span>claims checked</span></div>
            <div className={findings.summary.contradicted ? 'bad' : ''}><strong>{findings.summary.contradicted}</strong><span>contradicted</span></div>
            <div><strong>{findings.summary.supported}</strong><span>supported</span></div>
          </div>

          <div className="report-actions">
            <button type="button" className="btn-outline" onClick={exportReport}>Export report (JSON)</button>
            <span className="analyze-hint">Includes every finding with its time, claims with sources, and the provenance result. Frame pictures are left out.</span>
          </div>

          <div className="analyze-cards">
            <article className="panel result-block">
              <div className="section-kicker">ALERTS</div>
              {findings.alerts.length === 0 ? <p className="analyze-empty">No high-priority findings.</p> : (
                <ul className="finding-list">
                  {findings.alerts.map((alert, index) => (
                    <li key={`alert-${index}`} className="finding high">
                      <strong>{alert.title}</strong>{alert.at != null && <button type="button" className="text-button" onClick={() => jump(alert.at)}>{formatTime(alert.at)}</button>}
                      <p>{alert.description}</p>
                    </li>
                  ))}
                </ul>
              )}
              {findings.alerts.length > 0 && <button type="button" className="btn-outline" onClick={() => setPopupOpen(true)}>Show alerts again</button>}
            </article>

            <article className="panel result-block">
              <div className="section-kicker">CLAIMS</div>
              {!result.text ? <p className="analyze-empty">No transcript or on-screen text to check.</p> : findings.claims.length === 0 ? <p className="analyze-empty">No checkable factual claims found.</p> : (
                <ul className="finding-list">
                  {findings.claims.map((claim, index) => (
                    <li key={`claim-${index}`} className={`finding ${claim.level}`}>
                      <strong>{claim.verdict}</strong>
                      <p>"{claim.claim}"</p>
                      <small>{claim.reason}</small>
                      {claim.logicIssue && <small className="logic-issue">Logic: {claim.logicIssue}</small>}
                      {claim.sources?.length > 0 && (
                        <ul className="source-list">
                          {claim.sources.map(source => <li key={source.link}><a href={source.link} target="_blank" rel="noreferrer">{source.title || source.link}</a></li>)}
                        </ul>
                      )}
                      {claim.evidenceLabel && <small className="evidence-source">Checked against: {claim.evidenceLabel}</small>}
                      {claim.searchError && <small>Search note: {claim.searchError}</small>}
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="panel result-block">
              <div className="section-kicker">SPOKEN WORDS</div>
              {result.speechNotice && <p className="analyze-empty">{result.speechNotice}</p>}
              {result.speechError && <p className="inline-error" role="alert">{result.speechError}</p>}
              {result.transcriptSource === 'typed' && <p className="analyze-empty">Checked your typed or uploaded transcript.</p>}
              {result.transcriptSource === 'speech' && (
                <>
                  <p className="analyze-empty">Transcribed in your browser with {SPEECH_MODEL.label} ({SPEECH_MODEL.license}). Errors are likely, especially in noisy audio or Hindi. Check it against the clip.</p>
                  {result.speech.length === 0 ? <p className="analyze-empty">No speech was recognised.</p> : (
                    <ul className="transcript-lines">
                      {result.speech.map((segment, index) => (
                        <li key={`seg-${index}`}>
                          <button type="button" className="text-button" onClick={() => jump(segment.start)}>{formatTime(segment.start)}</button>
                          <span>{segment.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {!result.transcriptSource && !result.speechError && !result.speechNotice && <p className="analyze-empty">No spoken words to check. Tick the browser transcription box, or paste a transcript.</p>}
            </article>

            <article className="panel result-block provenance-card">
              <div className="section-kicker">CONTENT CREDENTIALS (C2PA)</div>
              {result.provenance?.status === 'none' && <p className="analyze-empty">{result.provenance.note}</p>}
              {result.provenance?.status === 'error' && <p className="inline-error" role="alert"><strong>{result.provenance.headline}.</strong> {result.provenance.note}</p>}
              {result.provenance?.status === 'present' && (
                <>
                  <p className={`provenance-head ${result.provenance.aiDeclared ? 'bad' : ''}`}><strong>{result.provenance.headline}</strong></p>
                  <dl className="provenance-details">
                    {result.provenance.details.map(item => (
                      <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>
                    ))}
                  </dl>
                  {result.provenance.failures.length > 0 && (
                    <ul className="finding-list">
                      {result.provenance.failures.map((failure, index) => <li key={index} className="finding high">{failure}</li>)}
                    </ul>
                  )}
                  <p className="analyze-empty">{result.provenance.note}</p>
                </>
              )}
            </article>

            <article className="panel result-block">
              <div className="section-kicker">DEEPFAKE &amp; AI-GENERATED CHECK</div>
              <p className="analyze-empty">No automatic check for AI-generated or deepfake content runs on this page. The free models we tested could not tell real images from generated ones, so none is used. The vision model's low-confidence observations are listed below for a human to check.</p>
              {findings.synthetic.length === 0 ? <p className="analyze-empty">No synthetic-artifact observations.</p> : (
                <ul className="finding-list">
                  {findings.synthetic.map((item, index) => (
                    <li key={`syn-${index}`} className="finding low">
                      <strong>{formatTime(item.at)}</strong> <button type="button" className="text-button" onClick={() => jump(item.at)}>jump</button>
                      <p>{item.description}</p>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="panel result-block">
              <div className="section-kicker">FRAME LOG</div>
              <ul className="finding-list frame-log">
                {result.frames.map((frame, index) => (
                  <li key={`frame-${index}`} className="finding low">
                    <button type="button" className="text-button" onClick={() => jump(frame.timestampSeconds)}>{formatTime(frame.timestampSeconds)}</button>
                    {frame.dataUrl && <img className="frame-thumb" src={frame.dataUrl} alt={`Frame at ${formatTime(frame.timestampSeconds)}`} />}
                    <span>{frame.onScreenText || 'No on-screen text'}</span>
                    {frame.dataUrl && (
                      <div className="frame-actions">
                        <a className="text-button" href={frame.dataUrl} download={frameFileName(file?.name, frame.timestampSeconds)}>Download frame</a>
                        {REVERSE_IMAGE_SEARCHES.map(engine => (
                          <a key={engine.id} className="text-button" href={engine.url} target="_blank" rel="noreferrer" title={engine.howTo}>Search with {engine.name}</a>
                        ))}
                        <small>Download the frame, then upload it on the search page.</small>
                      </div>
                    )}
                    {frame.issues.map((issue, i) => <small key={i} className={`issue-tag ${issue.severity}`}>{issue.category.replace(/_/g, ' ')} · {issue.severity}</small>)}
                    {frame.error && <small>Frame could not be analysed: {frame.error}</small>}
                  </li>
                ))}
              </ul>
            </article>
          </div>
          <p className="analyze-empty">These are judgments from frames and text: leads to check, not proof. Claim sources are shown under each claim.</p>
        </div>
      )}

      {popupOpen && findings?.alerts.length > 0 && (
        <AlertPopup alerts={findings.alerts} onJump={jump} onClose={() => setPopupOpen(false)} />
      )}
    </section>
  );
}
