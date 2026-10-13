import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { credentialFileName, createSignedCredential, getMediaKind } from '../credential.js';
import { getOrCreateIdentity } from '../storage.js';
import { extensionOf, formatBytes, formatDate } from '../data.js';

const MEDIA_EXTENSIONS = /\.(opus|ogg|m4a|mp3|wav|aac|flac|aiff|aif|webm|mp4|mov|m4v|mkv|avi|mpeg|mpg)$/i;

const initialForm = {
  issuer: '',
  title: '',
  sourceType: 'AI-generated media',
  model: '',
  language: '',
  note: '',
};

function downloadCredential(credential) {
  const blob = new Blob([JSON.stringify(credential, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = credentialFileName(credential);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function requestLocalFingerprint(file) {
  const body = new FormData();
  body.append('file', file);
  let response;
  try {
    response = await fetch('/api/fingerprint', { method: 'POST', body });
  } catch {
    throw new Error('The local media backend is unavailable. Start the RelayProof backend and install Chromaprint/fpcalc, or leave the optional fingerprint box unchecked.');
  }
  let result = {};
  try { result = await response.json(); } catch { /* Backend may be offline behind the Vite proxy. */ }
  if (!response.ok) {
    const detail = typeof result.detail === 'string' ? result.detail : 'local backend did not respond';
    throw new Error(`Chromaprint fingerprinting failed: ${detail}. This option needs the local backend and native Chromaprint.`);
  }
  return result;
}

export default function IssueView({ onCreate, onOpenCreated, notify }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [acknowledged, setAcknowledged] = useState(false);
  const [useChromaprint, setUseChromaprint] = useState(false);
  const [chromaprintStatus, setChromaprintStatus] = useState('checking');
  const [chromaprintMessage, setChromaprintMessage] = useState('Checking the local fingerprint service…');
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Local media backend is offline.')))
      .then(data => {
        setChromaprintStatus(data.chromaprintAvailable ? 'ready' : 'offline');
        setChromaprintMessage(data.chromaprintAvailable ? 'Local Chromaprint backend ready.' : (data.chromaprintMessage || 'Native Chromaprint is not configured.'));
      })
      .catch(() => {
        setChromaprintStatus('offline');
        setChromaprintMessage('Local backend is offline here. Start it on your own computer and refresh; exact-only issuance still works.');
      });
    return () => controller.abort();
  }, []);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const chooseFile = next => {
    if (!next) return;
    if (!next.type?.startsWith('audio/') && !next.type?.startsWith('video/') && !MEDIA_EXTENSIONS.test(next.name || '')) {
      notify('Please choose a common audio or video file.');
      return;
    }
    if (next.size > 128 * 1024 * 1024) {
      notify('This browser-only MVP supports audio/video files up to 128 MB.');
      return;
    }
    setFile(next);
    setCreated(null);
    setError('');
    if (!form.title) setForm(prev => ({ ...prev, title: next.name.replace(/\.[^.]+$/, '') }));
    notify('Media selected locally. It is sent only if you opt into local Chromaprint fingerprinting.');
  };

  const update = event => setForm(prev => ({ ...prev, [event.target.name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    if (!file) { notify('Choose a source audio or video file first.'); inputRef.current?.click(); return; }
    if (!acknowledged) { notify('Please acknowledge that this is a publisher declaration.'); return; }
    setBusy(true);
    setError('');
    try {
      const audioFingerprint = useChromaprint ? await requestLocalFingerprint(file) : undefined;
      const identity = await getOrCreateIdentity();
      const credential = await createSignedCredential({
        file,
        issuerName: form.issuer,
        title: form.title || file.name,
        declaredOrigin: form.sourceType,
        tool: form.model,
        language: form.language,
        note: form.note,
        identity,
        audioFingerprint,
      });
      const record = {
        id: credential.credentialId,
        credential,
        title: credential.asset.title,
        issuer: credential.issuer.name,
        format: extensionOf(file.name).toUpperCase(),
        date: formatDate(credential.issuedAt),
        fileName: file.name,
        digest: credential.asset.sha256,
        keyId: credential.issuer.keyId,
        issuedAt: credential.issuedAt,
        localKeyPersisted: identity.persisted,
      };
      setCreated({ record, persisted: identity.persisted });
      onCreate(record);
      notify(identity.persisted ? 'Signed credential created with your local browser key.' : 'Signed credential created; signing key is only in memory in this browser session.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not create the signed credential.';
      setError(message);
      notify(message);
    } finally {
      setBusy(false);
    }
  }

  const checklist = [
    ['Hash the exact source file', 'SHA-256 is computed in this browser; media is not uploaded in exact-only mode.'],
    ['Sign the declaration', 'A non-extractable ECDSA P-256 key signs the credential sidecar.'],
    ['Share the sidecar', 'Recipients verify the signature and exact file digest locally.'],
  ];

  return (
    <section className="view active" aria-label="Issue a signed audio or video provenance credential">
      <div className="page-intro"><div className="section-kicker">PUBLISHER WORKFLOW &nbsp;·&nbsp; 02</div><h1>Issue a source record.</h1><p>Sign a publisher declaration and bind it to the exact audio or video bytes. By default, signing stays in this browser; an optional Chromaprint reference is generated only by your self-hosted backend and covers audio content only. Neither is a C2PA manifest, external identity attestation, or re-encoding-resistant watermark.</p></div>
      <div className="issue-layout">
        <form className="form-panel panel" onSubmit={submit}>
          <div className="panel-head"><div><div className="micro-label">SIGNED SIDE-CAR CREDENTIAL</div><h2 className="panel-title" style={{ marginTop: 7 }}>Asset declaration</h2><p className="panel-subtitle">The claim is signed as entered; the signature does not certify its truth.</p></div><span className="local-tag">LOCAL SIGNING</span></div>
          <div
            className={`dropzone${drag ? ' dragover' : ''}`}
            style={{ minHeight: 110, padding: 13 }}
            onClick={event => { if (!event.target.closest('button')) inputRef.current?.click(); }}
            onDragEnter={event => { event.preventDefault(); setDrag(true); }}
            onDragOver={event => { event.preventDefault(); setDrag(true); }}
            onDragLeave={event => { event.preventDefault(); setDrag(false); }}
            onDrop={event => { event.preventDefault(); setDrag(false); chooseFile(event.dataTransfer.files[0]); }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
              <div className="upload-symbol" style={{ margin: 0 }}><Icon name={file && getMediaKind(file) === 'video' ? 'video' : 'audio'} size={17} /></div>
              <div><p className="drop-title" style={{ fontSize: 14 }}>Select the original audio or video</p><p className="drop-hint" style={{ margin: '4px 0 0' }}>Up to 128 MB · exact-only issuance stays in this browser.</p></div>
              <button className="btn-outline" type="button" onClick={event => { event.stopPropagation(); inputRef.current?.click(); }} style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>Choose file</button>
            </div>
          </div>
          <input ref={inputRef} className="hidden-file" type="file" accept="audio/*,video/*,.opus,.ogg,.m4a,.mp3,.wav,.aac,.flac,.aiff,.aif,.webm,.mp4,.mov,.m4v,.mkv,.avi,.mpeg,.mpg" onChange={event => { chooseFile(event.target.files[0]); event.target.value = ''; }} />
          {file && <div className="local-file-card show"><div className="file-name">{file.name}</div><div className="file-meta">{formatBytes(file.size)} · {file.type || 'media file'} · {useChromaprint ? 'sent to your local backend on issue' : 'not uploaded'}</div><div className="file-meta">SHA-256 is calculated when you issue.</div></div>}

          <div className="form-grid">
            <div className="field"><label htmlFor="issuer">Publisher / issuer</label><input id="issuer" name="issuer" value={form.issuer} onChange={update} placeholder="Your organization or publisher name" required /></div>
            <div className="field"><label htmlFor="title">Asset title</label><input id="title" name="title" value={form.title} onChange={update} placeholder="Short descriptive title" required /></div>
            <div className="field"><label htmlFor="sourceType">Declared origin</label><select id="sourceType" name="sourceType" value={form.sourceType} onChange={update}><option>AI-generated media</option><option>AI-assisted edit</option><option>Human-recorded / captured media</option><option>Other publisher claim</option></select></div>
            <div className="field"><label htmlFor="model">Tool / model (if known)</label><input id="model" name="model" value={form.model} onChange={update} placeholder="e.g. provider / model version" /></div>
            <div className="field"><label htmlFor="language">Language (optional)</label><input id="language" name="language" value={form.language} onChange={update} placeholder="e.g. English, Marathi" /></div>
            <div className="field full"><label htmlFor="note">Publisher note (optional)</label><textarea id="note" name="note" rows="2" value={form.note} onChange={update} placeholder="Avoid sensitive personal information." /></div>
          </div>
          <label className="check-row chromaprint-option"><input type="checkbox" checked={useChromaprint} onChange={event => setUseChromaprint(event.target.checked)} /><span><strong>Attach an experimental Chromaprint reference{file && getMediaKind(file) === 'video' ? ' for the audio track' : ''}</strong><small>Opt-in: sends this media to your self-hosted local backend to fingerprint up to 120 seconds of audio. For videos, visual frames are not covered. It may help find near-identical audio; it is not a watermark or proof of origin, and scores are uncalibrated.</small><small className={`chromaprint-service-status ${chromaprintStatus}`}><i />{chromaprintMessage}</small></span></label>
          <label className="check-row"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>I confirm this is a publisher declaration. It does not certify the truth of the media or the identity/consent of any person shown or heard.</span></label>
          <div className="form-actions"><button type="submit" className="btn-primary" disabled={busy}><Icon name="issue" size={15} />{busy ? (useChromaprint ? 'Fingerprinting, hashing & signing…' : 'Hashing and signing…') : 'Sign & issue credential'}</button><span className="form-footnote">ECDSA P-256 · exact SHA-256{useChromaprint ? ' + local Chromaprint' : ''} · {useChromaprint ? 'self-hosted backend only' : 'no upload'}</span></div>
          {error && <div className="inline-error" role="alert">{error}</div>}
          {created && <div className="created-state show" aria-live="polite"><h4>Signed sidecar created</h4><p>Signature valid for this signed claim. The embedded public key is self-asserted; recipients must verify publisher identity separately.</p><div className="created-id">{created.record.id} · {created.record.keyId}</div><div className="created-actions"><button type="button" className="btn-dark" onClick={() => downloadCredential(created.record.credential)}><Icon name="download" size={13} /> Download sidecar</button><button type="button" className="text-button" onClick={() => onOpenCreated(created.record, file)}>Open in verifier →</button></div><div className="key-storage-note">{created.persisted ? 'Non-extractable signing key stored in this browser’s IndexedDB.' : 'Warning: IndexedDB persistence unavailable; the key may be lost when this tab closes.'}</div></div>}
        </form>
        <aside className="issue-side panel">
          <div className="side-eyebrow">A responsible credential</div><h3>Record what the publisher can actually attest.</h3><p>The verifier reports three separate facts: signature integrity, exact-file match, and whether you pinned the key. None is a truth score.</p>
          {checklist.map(([title, copy]) => <div className="issue-check" key={title}><Icon name="check" size={14} /><div><strong>{title}</strong><span>{copy}</span></div></div>)}
          <div className="capability-box"><strong>Available now</strong><span>ECDSA signed sidecar + exact-byte SHA-256. Optional Chromaprint reference and candidate comparison need your local native backend.</span></div>
          <div className="capability-box pending"><strong>Not connected yet</strong><span>C2PA manifest checks, watermark / SBR recovery, and Monad anchoring.</span></div>
          <div className="key-warning"><strong>Key custody</strong><br />The private key is non-extractable and stays in this browser’s IndexedDB. Clearing site data loses it. This MVP has no key backup, account sync, or production identity registry.</div>
        </aside>
      </div>
      <div className="footer-note"><span>RelayProof · Signed media sidecar v1</span><span>{useChromaprint ? 'Media sent only to your self-hosted local backend for fingerprinting' : 'Exact-only processing · no media uploaded'} · Issued {created ? created.record.date : 'credentials stored in this browser'}</span></div>
    </section>
  );
}
