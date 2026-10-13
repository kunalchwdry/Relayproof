import React, { useEffect, useRef } from 'react';
import Icon from './Icons.jsx';
import { credentialFileName, isRelayProofCredential } from '../credential.js';

export default function ReceiptDialog({ record, onClose, notify }) {
  const ref = useRef(null);
  const credential = record?.credential || (isRelayProofCredential(record) ? record : null);
  const json = credential ? JSON.stringify(credential, null, 2) : '';

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (record && !dialog.open) dialog.showModal();
    if (!record && dialog.open) dialog.close();
  }, [record]);

  async function copyCredential() {
    try {
      await navigator.clipboard.writeText(json);
      notify('Signed sidecar JSON copied.');
    } catch {
      notify('Clipboard access is unavailable. Use Download sidecar instead.');
    }
  }

  function downloadCredential() {
    if (!credential) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = credentialFileName(credential);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Downloaded the signed credential sidecar.');
  }

  return (
    <dialog ref={ref} aria-labelledby="dialog-title" onClose={onClose} onClick={event => { if (event.target === ref.current) onClose(); }}>
      <div className="dialog-head">
        <h2 id="dialog-title">Signed credential sidecar</h2>
        <button type="button" className="dialog-close" onClick={onClose} aria-label="Close"><Icon name="close" size={13} /></button>
      </div>
      <div className="dialog-content">
        <p>This is the actual RelayProof signed JSON sidecar. It contains a self-asserted public key and exact-file SHA-256 claim. Share it alongside the matching audio or video. Any optional Chromaprint reference covers only a candidate audio-track comparison, not the video frames. It is not a C2PA manifest, an identity certificate, an external timestamp, or a Monad transaction.</p>
        {credential ? <pre className="receipt-json">{json}</pre> : <p>No signed credential JSON is available for this archive entry.</p>}
        <div className="dialog-actions">
          <button type="button" className="btn-outline" onClick={copyCredential} disabled={!credential}>Copy JSON</button>
          <button type="button" className="btn-primary" onClick={downloadCredential} disabled={!credential}>Download sidecar</button>
        </div>
      </div>
    </dialog>
  );
}
