import React, { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import VerifyView from './components/VerifyView.jsx';
import IssueView from './components/IssueView.jsx';
import ArchiveView from './components/ArchiveView.jsx';
import ReceiptDialog from './components/ReceiptDialog.jsx';
import ContentReviewView from './components/ContentReviewView.jsx';
import AnalyzeView from './components/AnalyzeView.jsx';
import { getMediaKind, isRelayProofCredential, sha256Hex, verifyCredentialAgainstFile, verifyCredentialSignature } from './credential.js';
import { isKeyTrusted, loadRecords, loadTrustedKeys, pinTrustedKey, saveRecords } from './storage.js';

const MEDIA_EXTENSION = /\.(opus|ogg|m4a|mp3|wav|aac|flac|aiff|aif|webm|mp4|mov|m4v|mkv|avi|mpeg|mpg)$/i;
const MAX_CREDENTIAL_BYTES = 1024 * 1024;

export default function App() {
  const [view, setView] = useState('verify');
  const [records, setRecords] = useState(() => loadRecords());
  const [trustedKeys, setTrustedKeys] = useState(() => loadTrustedKeys());
  const [activeCredential, setActiveCredential] = useState(null);
  const [verification, setVerification] = useState({ status: 'empty' });
  const [verifyFile, setVerifyFile] = useState(null);
  const [fingerprintBusy, setFingerprintBusy] = useState(false);
  const [receiptRecord, setReceiptRecord] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimer = useRef(null);
  const fileUrlRef = useRef(null);
  const verifySequence = useRef(0);
  const fingerprintSequence = useRef(0);
  const credentialRef = useRef(null);
  const fileRef = useRef(null);

  const notify = useCallback(message => {
    setToastMessage(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(''), 3300);
  }, []);

  const navigate = useCallback(name => {
    setView(name);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const inspect = useCallback(async (file, credential = credentialRef.current) => {
    const sequence = ++verifySequence.current;
    if (!file) {
      setVerification({ status: 'empty' });
      return;
    }
    setVerification({ status: 'checking', fileName: file.name });
    try {
      if (!credential) {
        const digest = await sha256Hex(file);
        if (sequence !== verifySequence.current) return;
        setVerifyFile(current => current?.file === file ? { ...current, hash: digest, hashing: false } : current);
        setVerification({ status: 'no-credential', fileName: file.name, submittedDigest: digest });
        return;
      }

      const result = await verifyCredentialAgainstFile(credential, file);
      if (sequence !== verifySequence.current) return;
      setVerifyFile(current => current?.file === file ? { ...current, hash: result.submittedDigest || '', hashing: false } : current);
      const trusted = result.valid && isKeyTrusted(trustedKeys, result.keyId);
      const status = !result.valid ? 'invalid-credential' : result.digestMatches ? (trusted ? 'verified-trusted' : 'verified-untrusted') : 'digest-mismatch';
      setVerification({ ...result, status, trusted, fileName: file.name });
    } catch (error) {
      if (sequence !== verifySequence.current) return;
      setVerifyFile(current => current?.file === file ? { ...current, hashing: false, hash: '' } : current);
      setVerification({ status: 'error', fileName: file.name, reason: error instanceof Error ? error.message : 'Local verification failed.' });
    }
  }, [trustedKeys]);

  const compareChromaprint = useCallback(async () => {
    const credential = credentialRef.current;
    const file = fileRef.current;
    const reference = credential?.audioFingerprint;
    if (!file || !reference?.fingerprint || reference.algorithm !== 'Chromaprint') {
      notify('This sidecar has no Chromaprint reference, or no audio/video file is selected.');
      return;
    }
    const token = ++fingerprintSequence.current;
    setFingerprintBusy(true);
    setVerification(previous => ({ ...previous, fingerprintChecking: true, fingerprintError: '', fingerprintMatch: null }));
    try {
      const signature = await verifyCredentialSignature(credential);
      if (!signature.valid) throw new Error('The signed sidecar must verify before its fingerprint is used.');
      const body = new FormData();
      body.append('file', file);
      body.append('reference_fingerprint', reference.fingerprint);
      body.append('reference_duration', String(reference.durationSeconds));
      let response;
      try {
        response = await fetch('/api/fingerprint/compare', { method: 'POST', body });
      } catch {
        throw new Error('The local media backend is offline. Start it on your own computer before comparing private audio.');
      }
      let result = {};
      try { result = await response.json(); } catch { /* The local proxy may be offline. */ }
      if (!response.ok) {
        throw new Error(typeof result.detail === 'string' ? result.detail : 'Local Chromaprint backend unavailable.');
      }
      const similarity = Number(result.similarity);
      if (!Number.isFinite(similarity) || similarity < 0 || similarity > 1) throw new Error('The local service returned an invalid similarity score.');
      if (token !== fingerprintSequence.current || credentialRef.current !== credential || fileRef.current !== file) return;
      setVerification(previous => ({
        ...previous,
        fingerprintChecking: false,
        fingerprintError: '',
        fingerprintMatch: {
          algorithm: 'Chromaprint',
          similarity,
          interpretation: getMediaKind(file) === 'video'
            ? 'Audio-track-only candidate score; video frames are not compared. Uncalibrated and not provenance verification.'
            : (result.interpretation || 'Uncalibrated candidate score only; not provenance verification.'),
        },
      }));
      notify(`Chromaprint candidate similarity: ${(similarity * 100).toFixed(1)}%. This score is not a provenance verdict.`);
    } catch (error) {
      if (token !== fingerprintSequence.current || credentialRef.current !== credential || fileRef.current !== file) return;
      const message = error instanceof Error ? error.message : 'Chromaprint comparison failed.';
      setVerification(previous => ({ ...previous, fingerprintChecking: false, fingerprintError: message, fingerprintMatch: null }));
      notify(message);
    } finally {
      if (token === fingerprintSequence.current) setFingerprintBusy(false);
    }
  }, [notify]);

  const handleFile = useCallback((file, credentialOverride) => {
    if (!file) return;
    fingerprintSequence.current += 1;
    setFingerprintBusy(false);
    if (!file.type?.startsWith('audio/') && !file.type?.startsWith('video/') && !MEDIA_EXTENSION.test(file.name || '')) {
      notify('Choose a common audio or video file.');
      return;
    }
    if (file.size > 128 * 1024 * 1024) {
      notify('This browser-side verifier supports audio/video files up to 128 MB.');
      return;
    }
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    const url = URL.createObjectURL(file);
    fileUrlRef.current = url;
    fileRef.current = file;
    setVerifyFile({ file, url, hash: '', hashing: true });
    inspect(file, credentialOverride === undefined ? credentialRef.current : credentialOverride);
  }, [inspect, notify]);

  const clearFile = useCallback(() => {
    verifySequence.current += 1;
    fingerprintSequence.current += 1;
    setFingerprintBusy(false);
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    fileUrlRef.current = null;
    fileRef.current = null;
    setVerifyFile(null);
    if (credentialRef.current) {
      verifyCredentialSignature(credentialRef.current).then(result => {
        const trusted = result.valid && isKeyTrusted(trustedKeys, result.keyId);
        setVerification({ ...result, status: result.valid ? 'signature-only' : 'invalid-credential', trusted });
      });
    } else {
      setVerification({ status: 'empty' });
    }
    notify('Selected media removed.');
  }, [notify, trustedKeys]);

  const handleCredential = useCallback(async file => {
    if (!file) return;
    fingerprintSequence.current += 1;
    setFingerprintBusy(false);
    if (file.size > MAX_CREDENTIAL_BYTES) {
      notify('Credential sidecars must be 1 MB or smaller.');
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      if (!isRelayProofCredential(parsed)) throw new Error('This JSON is not a supported RelayProof signed credential.');
      credentialRef.current = parsed;
      setActiveCredential(parsed);
      notify('Signed credential loaded. Checking its signature and file binding locally.');
      if (fileRef.current) inspect(fileRef.current, parsed);
      else {
        const result = await verifyCredentialSignature(parsed);
        const trusted = result.valid && isKeyTrusted(trustedKeys, result.keyId);
        setVerification({ ...result, status: result.valid ? 'signature-only' : 'invalid-credential', trusted });
      }
    } catch (error) {
      verifySequence.current += 1;
      credentialRef.current = null;
      setActiveCredential(null);
      setVerification({ status: 'invalid-credential', reason: error instanceof Error ? error.message : 'Could not read this credential.' });
      notify(error instanceof Error ? error.message : 'Could not read this credential.');
    }
  }, [inspect, notify, trustedKeys]);

  const clearCredential = useCallback(() => {
    fingerprintSequence.current += 1;
    setFingerprintBusy(false);
    credentialRef.current = null;
    setActiveCredential(null);
    if (fileRef.current) inspect(fileRef.current, null);
    else setVerification({ status: 'empty' });
    notify('Credential sidecar removed.');
  }, [inspect, notify]);

  const createRecord = useCallback((record) => {
    const next = [record, ...records.filter(item => item.id !== record.id)];
    setRecords(next);
    if (!saveRecords(next)) notify('Credential created, but browser storage is unavailable; export the sidecar now to keep a copy.');
  }, [notify, records]);

  const openCreated = useCallback((record, file) => {
    credentialRef.current = record.credential;
    setActiveCredential(record.credential);
    setView('verify');
    if (file) handleFile(file, record.credential);
    else if (fileRef.current) inspect(fileRef.current, record.credential);
    else {
      verifyCredentialSignature(record.credential).then(result => {
        const trusted = result.valid && isKeyTrusted(trustedKeys, result.keyId);
        setVerification({ ...result, status: result.valid ? 'signature-only' : 'invalid-credential', trusted });
      });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [handleFile, inspect, trustedKeys]);

  const useArchivedCredential = useCallback(record => {
    if (!record?.credential) return;
    credentialRef.current = record.credential;
    setActiveCredential(record.credential);
    setView('verify');
    if (fileRef.current) inspect(fileRef.current, record.credential);
    else verifyCredentialSignature(record.credential).then(result => {
      const trusted = result.valid && isKeyTrusted(trustedKeys, result.keyId);
      setVerification({ ...result, status: result.valid ? 'signature-only' : 'invalid-credential', trusted });
    });
  }, [inspect, trustedKeys]);

  const trustCurrentIssuer = useCallback(() => {
    const keyId = verification.keyId || activeCredential?.issuer?.keyId;
    if (!verification.valid || !keyId) {
      notify('Only a signature-valid credential can be pinned.');
      return;
    }
    const result = pinTrustedKey(keyId, verification.issuerName || activeCredential?.issuer?.name || '');
    setTrustedKeys(result.keys);
    setVerification(previous => ({ ...previous, trusted: true, status: previous.digestMatches === true ? 'verified-trusted' : previous.status }));
    notify(result.saved ? 'Issuer key pinned on this device. This is not an external identity check.' : 'Key pin is not persistent in this browser; this is not an external identity check.');
  }, [activeCredential, notify, verification]);

  useEffect(() => {
    saveRecords(records);
  }, [records]);

  useEffect(() => () => {
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    window.clearTimeout(toastTimer.current);
  }, []);

  const showTrust = useCallback(() => {
    if (view !== 'verify') {
      setView('verify');
      window.setTimeout(() => document.getElementById('trust-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    } else {
      document.getElementById('trust-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [view]);

  return (
    <div className="app-shell">
      <Sidebar view={view} onNavigate={navigate} count={records.length} />
      <main className="main">
        <Topbar view={view} onTrust={showTrust} />
        <div className="content">
          {view === 'verify' && (
            <VerifyView
              onOpenIssue={() => navigate('issue')}
              onShowReceipt={record => setReceiptRecord(record)}
              onCredential={handleCredential}
              onClearCredential={clearCredential}
              credential={activeCredential}
              verification={verification}
              trustedKeys={trustedKeys}
              onPinIssuer={trustCurrentIssuer}
              onCompareChromaprint={compareChromaprint}
              fingerprintBusy={fingerprintBusy}
              localFile={verifyFile}
              onFile={handleFile}
              onClearFile={clearFile}
              onExplain={showTrust}
            />
          )}
          {view === 'issue' && <IssueView onCreate={createRecord} onOpenCreated={openCreated} notify={notify} />}
          {view === 'archive' && (
            <ArchiveView
              records={records}
              trustedKeys={trustedKeys}
              onOpenReceipt={record => setReceiptRecord(record)}
              onUseCredential={useArchivedCredential}
              onIssue={() => navigate('issue')}
            />
          )}
          {view === 'review' && <ContentReviewView notify={notify} />}
          {view === 'analyze' && <AnalyzeView notify={notify} />}
        </div>
      </main>
      <ReceiptDialog record={receiptRecord} onClose={() => setReceiptRecord(null)} notify={notify} />
      <div className={`toast${toastMessage ? ' show' : ''}`} role="status" aria-live="polite">{toastMessage}</div>
    </div>
  );
}
