import React from 'react';
import Icon from './Icons.jsx';
import { formatDate } from '../data.js';

const states = {
  empty: {
    label: 'Ready for local verification', tone: 'neutral', icon: 'info',
    copy: 'Choose an audio/video file and its signed RelayProof sidecar. Nothing is uploaded for exact-byte verification.',
  },
  checking: {
    label: 'Checking locally…', tone: 'neutral', icon: 'fingerprint',
    copy: 'Computing SHA-256 and checking the credential signature in this browser.',
  },
  'no-credential': {
    label: 'No credential supplied', tone: 'warn', icon: 'info',
    copy: 'A local file hash is available, but no source credential was supplied or resolved. No provenance conclusion is possible.',
  },
  'signature-only': {
    label: 'Signature valid · file not checked', tone: 'warn', icon: 'shield',
    copy: 'The sidecar was signed by the public key it contains. Load the audio/video file to check whether its exact bytes match.',
  },
  'verified-untrusted': {
    label: 'Signature valid · exact file match', tone: 'warn', icon: 'check',
    copy: 'The signed SHA-256 matches this exact file. The embedded issuer key is not independently trusted on this device.',
  },
  'verified-trusted': {
    label: 'Exact file match · key pinned here', tone: 'success', icon: 'check',
    copy: 'The signature is valid, the exact media bytes match, and this browser has pinned the issuer key. Pinning is not an external identity check.',
  },
  'digest-mismatch': {
    label: 'Signed credential · bytes differ', tone: 'warn', icon: 'warning',
    copy: 'The signature may still be valid, but this media file does not match the signed exact-byte digest. If a Chromaprint reference is attached, an optional audio-only candidate score is available; it cannot verify provenance.',
  },
  'invalid-credential': {
    label: 'Credential could not be verified', tone: 'bad', icon: 'close',
    copy: 'The sidecar is malformed, uses an unsupported format, or its signature/key reference failed validation.',
  },
  error: {
    label: 'Local check could not finish', tone: 'bad', icon: 'warning',
    copy: 'The browser could not complete this check. No remote service was contacted.',
  },
};

function shortDigest(value) {
  if (!value) return 'Not computed';
  return `${value.slice(0, 18)}…${value.slice(-12)}`;
}

export default function ResultCard({ verification, credential, localFile, onReceipt, onPinIssuer, onCompareChromaprint, fingerprintBusy, trusted }) {
  const state = states[verification?.status] || states.empty;
  const tone = state.tone === 'success' ? '' : state.tone;
  const issuer = credential?.issuer?.name || verification?.issuerName || 'No issuer supplied';
  const digestMatches = verification?.digestMatches;
  const signatureLabel = verification?.valid === true ? 'Valid' : verification?.valid === false ? 'Invalid' : 'Not checked';
  const bindingLabel = digestMatches === true ? 'Exact bytes match' : digestMatches === false ? 'No exact match' : localFile ? 'Not checked' : 'No file';
  const trustLabel = trusted ? 'Pinned on this device' : verification?.valid ? 'Not pinned' : 'Not established';
  const date = credential?.issuedAt ? formatDate(credential.issuedAt) : '—';
  const fingerprintScore = verification?.fingerprintMatch?.similarity;
  const fingerprintLabel = Number.isFinite(fingerprintScore)
    ? `${(fingerprintScore * 100).toFixed(1)}% · candidate score only`
    : verification?.fingerprintError ? 'Unavailable · see message' : credential?.audioFingerprint ? 'Attached · not compared' : 'Not included in sidecar';
  const signals = [
    { label: 'ECDSA sidecar signature', value: signatureLabel, icon: 'shield', tone: verification?.valid === false ? 'bad' : verification?.valid ? '' : 'neutral' },
    { label: 'Exact SHA-256 binding', value: bindingLabel, icon: 'fingerprint', tone: digestMatches === false ? 'warn' : digestMatches === true ? '' : 'neutral' },
    { label: 'Chromaprint candidate similarity', value: fingerprintLabel, icon: 'audio', tone: Number.isFinite(fingerprintScore) ? 'warn' : 'neutral' },
    { label: 'Issuer key status', value: trustLabel, icon: 'issue', tone: trusted ? '' : 'warn' },
    { label: 'Watermark / SBR recovery', value: 'Not connected · API details pending', icon: 'audio', tone: 'neutral' },
  ];

  return (
    <article className="result-card" aria-live="polite">
      <div className="result-top">
        <div className="result-top-left"><span className="micro-label">LOCAL VERIFICATION</span><span className="local-tag">CRYPTO CHECK</span></div>
        <span className="no-upload-note">{fingerprintBusy || verification?.fingerprintMatch || verification?.fingerprintError ? 'Local backend used' : 'No upload'}</span>
      </div>
      <div className="result-body">
        <div className="result-state">
          <div className={`state-icon ${tone}`}><Icon name={state.icon} size={17} /></div>
          <div><h3 className={`state-heading ${tone}`}>{state.label}</h3><p className="state-copy">{state.copy}</p></div>
        </div>
        {verification?.reason && <div className={`verification-reason${verification.status === 'invalid-credential' || verification.status === 'error' ? ' reason-error' : ''}`}>{verification.reason}</div>}
        {verification?.fingerprintError && <div className="verification-reason reason-error">Chromaprint candidate comparison unavailable: {verification.fingerprintError}</div>}
        <div className="issuer-card">
          <div className="issuer-seal"><Icon name="shield" size={21} /></div>
          <div className="issuer-details">
            <div className="issuer-label">Claimed publisher · not inherently verified</div>
            <div className="issuer-name">{issuer}</div>
            <div className="issuer-sub">
              <span className="key-id">{credential?.issuer?.keyId || verification?.keyId || 'No key loaded'}</span>
              {trusted && <span className="trusted-badge">Pinned on this device</span>}
            </div>
          </div>
        </div>
        <div className="audio-meta-row">
          <div className="meta-cell"><div className="meta-label">Media file</div><div className="meta-value" title={localFile?.file?.name}>{localFile?.file?.name || verification?.fileName || 'Not selected'}</div></div>
          <div className="meta-cell"><div className="meta-label">Exact binding</div><div className="meta-value">{bindingLabel}</div></div>
          <div className="meta-cell"><div className="meta-label">Issued</div><div className="meta-value">{date}</div></div>
        </div>
        <div className="signal-list">
          {signals.map(signal => (
            <div className="signal-row" key={signal.label}>
              <span className="signal-name"><Icon name={signal.icon} size={13} /> {signal.label}</span>
              <span className={`signal-value${signal.tone ? ` ${signal.tone}` : ''}`}>{signal.value}</span>
            </div>
          ))}
        </div>
        {localFile && <div className="digest-line"><span>Current file SHA-256</span><code title={verification?.submittedDigest || localFile.hash}>{shortDigest(verification?.submittedDigest || localFile.hash)}</code></div>}
        <div className="result-actions">
          {credential ? <button type="button" className="btn-dark" onClick={() => onReceipt({ credential, id: credential.credentialId, title: credential.asset?.title, issuer: credential.issuer?.name })}><Icon name="receipt" size={13} /> View signed sidecar</button> : <span className="result-helper">Need a credential? Issue one for an original file.</span>}
          {verification?.status === 'digest-mismatch' && credential?.audioFingerprint?.fingerprint && <button type="button" className="btn-outline" onClick={onCompareChromaprint} disabled={fingerprintBusy}>{fingerprintBusy ? 'Comparing locally…' : verification?.fingerprintMatch ? 'Compare again' : credential.mediaKind === 'video' ? 'Compare audio track · experimental' : 'Compare fingerprint · experimental'}</button>}
          {verification?.valid && !trusted && <button type="button" className="text-button pin-button" onClick={onPinIssuer}>Pin this key</button>}
        </div>
        {credential && <div className="simulation-caption">This is RelayProof’s local sidecar format, not C2PA. A valid signature proves the signed bytes/claims were signed by the included key; it does not prove the publisher’s real-world identity or claim truth. Chromaprint scores compare audio only, are uncalibrated candidate hints, and never override the exact-byte result.</div>}
      </div>
    </article>
  );
}
