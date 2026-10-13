import React, { useRef } from 'react';
import Icon from './Icons.jsx';
import ResultCard from './ResultCard.jsx';
import { formatBytes } from '../data.js';

const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)$/i;
const isVideoFile = file => file?.type?.startsWith('video/') || VIDEO_EXTENSION.test(file?.name || '');

function LocalFileCard({ localFile, onClear }) {
  if (!localFile) return null;
  return (
    <div className="local-file-card show" aria-live="polite">
      <div className="local-file-top">
        <div className="local-file-info">
          <span className="file-icon"><Icon name={isVideoFile(localFile.file) ? 'video' : 'audio'} size={15} /></span>
          <span style={{ minWidth: 0 }}><span className="file-name">{localFile.file.name}</span><span className="file-meta">{formatBytes(localFile.file.size)} · {localFile.file.type || 'media file'} · local only</span></span>
        </div>
        <button className="text-button" type="button" onClick={onClear}>Remove</button>
      </div>
      <div className="file-hash">{localFile.hashing ? 'Computing SHA-256 locally…' : localFile.hash ? `SHA-256 · ${localFile.hash}` : 'Digest not available.'}</div>
      {localFile.url && (isVideoFile(localFile.file) ? <video className="preview-video" controls playsInline preload="metadata" src={localFile.url} /> : <audio className="preview-audio" controls src={localFile.url} />)}
      <div className="prototype-note">A digest match means exact byte equality with the signed credential. A different digest is not evidence of forgery. If the signed sidecar includes Chromaprint, you may opt to send this file to your self-hosted backend for an uncalibrated audio-only candidate score; for video, no frames are included.</div>
    </div>
  );
}

function CredentialCard({ credential, onClear }) {
  if (!credential) return null;
  return (
    <div className="credential-loaded-card show" aria-live="polite">
      <span className="credential-loaded-icon"><Icon name="receipt" size={14} /></span>
      <div className="credential-loaded-copy"><strong>{credential.issuer?.name || 'Unnamed issuer'}</strong><span>{credential.asset?.title || credential.asset?.fileName || 'Signed media claim'} · {credential.credentialId}{credential.mediaKind ? ` · ${credential.mediaKind}` : ''}{credential.audioFingerprint ? ' · Chromaprint audio reference attached' : ''}</span><code>{credential.issuer?.keyId}</code></div>
      <button type="button" className="text-button" onClick={onClear}>Remove</button>
    </div>
  );
}

function UploadPanel({ localFile, credential, onFile, onClear, onCredential, onClearCredential }) {
  const audioInput = useRef(null);
  const credentialInput = useRef(null);
  const [drag, setDrag] = React.useState(false);
  const handleAudioFiles = files => { if (files?.[0]) onFile(files[0]); if (audioInput.current) audioInput.current.value = ''; };
  const handleCredentialFiles = files => { if (files?.[0]) onCredential(files[0]); if (credentialInput.current) credentialInput.current.value = ''; };
  return (
    <article className="upload-panel panel" id="verification-workspace">
      <div className="panel-head">
        <div><div className="micro-label">01 &nbsp;·&nbsp; LOCAL CHECK</div><h3 className="panel-title" style={{ marginTop: 7 }}>Inspect an audio or video claim</h3><p className="panel-subtitle">Select the media and its signed sidecar for an exact-file check.</p></div>
        <span className="micro-label">LOCAL BY DEFAULT</span>
      </div>
      <div
        className={`dropzone${drag ? ' dragover' : ''}`}
        tabIndex={0}
        role="button"
        aria-label="Choose or drop an audio or video file"
        onClick={event => { if (!event.target.closest('button')) audioInput.current?.click(); }}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); audioInput.current?.click(); } }}
        onDragEnter={event => { event.preventDefault(); setDrag(true); }}
        onDragOver={event => { event.preventDefault(); setDrag(true); }}
        onDragLeave={event => { event.preventDefault(); setDrag(false); }}
        onDrop={event => { event.preventDefault(); setDrag(false); handleAudioFiles(event.dataTransfer.files); }}
      >
        <div>
          <div className="upload-symbol"><Icon name="upload" size={17} /></div>
          <p className="drop-title">Drop an audio or video file to inspect</p>
          <p className="drop-hint">Works with the original media file signed in the sidecar.</p>
          <button className="btn-outline" type="button" onClick={event => { event.stopPropagation(); audioInput.current?.click(); }}>Choose media</button>
          <div className="accept-line">AUDIO · MP4 / MOV / WEBM / MKV · MAX 128 MB</div>
        </div>
      </div>
      <input ref={audioInput} className="hidden-file" type="file" accept="audio/*,video/*,.opus,.ogg,.m4a,.mp3,.wav,.aac,.flac,.aiff,.aif,.webm,.mp4,.mov,.m4v,.mkv,.avi,.mpeg,.mpg" onChange={event => handleAudioFiles(event.target.files)} />
      <LocalFileCard localFile={localFile} onClear={onClear} />
      <div className="sidecar-picker">
        <div><strong>Signed sidecar</strong><span>Choose a `.relayproof.json` credential issued for this audio or video.</span></div>
        <button type="button" className="btn-outline" onClick={() => credentialInput.current?.click()}>{credential ? 'Replace sidecar' : 'Choose sidecar'}</button>
      </div>
      <input ref={credentialInput} className="hidden-file" type="file" accept="application/json,.json,.relayproof.json" onChange={event => handleCredentialFiles(event.target.files)} />
      <CredentialCard credential={credential} onClear={onClearCredential} />
      <div className="privacy-note"><Icon name="shield" size={13} /> Signature and exact hash checks run in-browser. Opt-in fingerprinting sends the selected media file to your self-hosted backend; for video, only its audio is fingerprinted and frames are not compared. No AcoustID web lookup is used.</div>
    </article>
  );
}

function CapabilityStrip() {
  const items = [
    ['Local ECDSA signature', 'Available now', 'ready'],
    ['Exact SHA-256 check', 'Available now', 'ready'],
    ['C2PA embedded manifest', 'Not integrated', 'pending'],
    ['Chromaprint candidate compare', 'Optional · local backend', 'pending'],
  ];
  return <div className="capability-strip">{items.map(([label, value, state]) => <div className="capability-item" key={label}><span className={`capability-dot ${state}`} /><span><strong>{label}</strong><small>{value}</small></span></div>)}</div>;
}

function TrailPanel() {
  const steps = [
    ['01', 'Publisher declares', 'Claim fields are signed'],
    ['02', 'Exact file bound', 'SHA-256 of source bytes'],
    ['03', 'Recipient checks', 'Sidecar signature + digest'],
    ['04', 'Derivative candidate', 'Chromaprint score only; no trust decision'],
  ];
  return (
    <article className="trail-panel panel">
      <div className="trail-head"><div><div className="section-kicker">VERIFICATION SCOPE</div><h3 className="trail-title">What works in this build</h3><div className="trail-sub">Exact-byte media credentials are live. Derivative provenance recovery is not.</div></div><span className="local-tag">STAGE 1</span></div>
      <div className="trail-steps">{steps.map(([number, title, caption]) => <div className="trail-step" key={number}><div className="trail-dot">{number}</div><strong>{title}</strong><span>{caption}</span></div>)}</div>
    </article>
  );
}

function CaveatPanel({ onExplain }) {
  return (
    <article className="caveat-panel panel" id="trust-card">
      <div className="caveat-icon"><Icon name="shield" size={15} /></div>
      <h3>Integrity is not identity.</h3>
      <p>A valid signature shows that the private key corresponding to the included public key signed the claim. It does not prove who controls that key, whether the claim is true, or who is speaking. Pin a key only after checking its fingerprint through a trusted channel.</p>
      <button className="unknown-pill" type="button" onClick={onExplain}><Icon name="info" size={11} /> No credential found ≠ fake</button>
    </article>
  );
}

export default function VerifyView({
  onOpenIssue, onShowReceipt, onCredential, onClearCredential,
  credential, verification, trustedKeys, onPinIssuer, onCompareChromaprint,
  fingerprintBusy, localFile, onFile, onClearFile, onExplain,
}) {
  const scrollToUpload = () => document.getElementById('verification-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const trusted = Boolean(verification?.trusted || trustedKeys?.some(item => item.keyId === verification?.keyId));
  return (
    <section className="view active" aria-label="Verify a signed audio or video credential">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-mark" /> TRACK 04 &nbsp;·&nbsp; AUDIO + VIDEO PROVENANCE</div>
          <h1>Give every clip<br /><em>a point of origin.</em></h1>
          <p>Issue and check a signed publisher claim against exact audio or video bytes. Optional local Chromaprint compares audio fingerprints only; it cannot establish provenance or compare video frames.</p>
          <div className="hero-actions">
            <button type="button" className="btn btn-brass" onClick={scrollToUpload}>Verify a file <Icon name="arrow" size={14} /></button>
            <button type="button" className="btn btn-hero-quiet" onClick={onOpenIssue}>Issue a credential</button>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="hero-index">SIGNAL / SOURCE / RECORD</span>
          <div className="art-ring" />
          <svg className="wave-hero" viewBox="0 0 440 180" fill="none" preserveAspectRatio="xMidYMid meet">
            <path d="M8 91c16 0 16-26 32-26s16 51 32 51 16-77 32-77 16 106 32 106 16-67 32-67 16 34 32 34 16-53 32-53 16 88 32 88 16-63 32-63 16 37 32 37 16-48 32-48 16 31 32 31 16-19 32-19" stroke="#D6BE91" strokeOpacity=".88" strokeWidth="1.15" strokeLinecap="round" />
            <path d="M8 103c16 0 16-11 32-11s16 19 32 19 16-34 32-34 16 43 32 43 16-28 32-28 16 14 32 14 16-22 32-22 16 37 32 37 16-27 32-27 16 16 32 16 16-20 32-20 16 13 32 13 16-8 32-8" stroke="#90AA9A" strokeOpacity=".55" strokeWidth=".8" strokeLinecap="round" />
            <circle cx="220" cy="91" r="6" fill="#D6BE91" fillOpacity=".13" stroke="#E3C99B" strokeOpacity=".6" /><circle cx="220" cy="91" r="2" fill="#E3C99B" />
          </svg>
          <div className="art-seal">Exact<br />bytes<span>stage one live</span></div>
        </div>
      </section>
      <CapabilityStrip />
      <div className="section-heading">
        <div><div className="section-kicker">THE VERIFICATION DESK</div><h2>Check the signed source claim.</h2><p>Load audio or video and its RelayProof sidecar. Exact SHA-256 is authoritative for byte matching; optional Chromaprint is only an audio-track candidate hint.</p></div>
        <button type="button" className="small-link" onClick={onExplain}>What a match means <span aria-hidden="true">↗</span></button>
      </div>
      <div className="workspace-grid">
        <UploadPanel localFile={localFile} credential={credential} onFile={onFile} onClear={onClearFile} onCredential={onCredential} onClearCredential={onClearCredential} />
        <ResultCard verification={verification} credential={credential} localFile={localFile} onReceipt={onShowReceipt} onPinIssuer={onPinIssuer} onCompareChromaprint={onCompareChromaprint} fingerprintBusy={fingerprintBusy} trusted={trusted} />
      </div>
      <div className="lower-grid"><TrailPanel /><CaveatPanel onExplain={onExplain} /></div>
      <div className="footer-note"><span>RelayProof · Local cryptographic verifier</span><span>C2PA, watermark recovery & Monad are not connected</span></div>
    </section>
  );
}
