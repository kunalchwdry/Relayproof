import React, { useEffect, useState } from 'react';

// Only the check's result fields are sent. The media file and the credential are never uploaded.
function pickFacts(verification) {
  const facts = {
    status: verification.status,
    fileName: verification.fileName,
    valid: verification.valid,
    digestMatches: verification.digestMatches,
    trusted: verification.trusted,
    reason: verification.reason,
    keyId: verification.keyId,
    issuerName: verification.issuerName || verification.issuer?.name,
  };
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

export default function AiExplain({ verification }) {
  const [available, setAvailable] = useState(null);
  const [busy, setBusy] = useState(false);
  const [explanation, setExplanation] = useState(null);
  const [error, setError] = useState('');
  const showable = verification && !['empty', 'checking'].includes(verification.status);
  const factsKey = showable ? JSON.stringify(pickFacts(verification)) : '';

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/nim/status', { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('unavailable')))
      .then(data => setAvailable(Boolean(data.explainAvailable)))
      .catch(() => setAvailable(false));
    return () => controller.abort();
  }, []);

  // A new check invalidates the previous explanation.
  useEffect(() => { setExplanation(null); setError(''); }, [factsKey]);

  if (!showable) return null;

  async function explain() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/nim/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pickFacts(verification)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `Explanation failed (HTTP ${response.status}).`);
      setExplanation(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Explanation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ai-explain panel" aria-label="AI explanation of this result">
      <div className="ai-explain-head">
        <div>
          <div className="section-kicker">AI EXPLANATION · NVIDIA NIM</div>
          <p className="ai-explain-lead">Get a plain-English reading of this result. The explanation is AI-written from the check's result fields only.</p>
        </div>
        <button type="button" className="btn-glow" onClick={explain} disabled={busy || available !== true}>
          {busy ? 'Explaining…' : explanation ? 'Explain again' : 'Explain this result'}
        </button>
      </div>
      {available === false && <div className="ai-explain-note">Not configured on this server. Ask the operator to set NVIDIA_API_KEY.</div>}
      <div className="ai-explain-note">Sends only the result fields above to NVIDIA NIM. Your media file and credential stay in this browser.</div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      {explanation && (
        <div className="ai-explain-body">
          <p>{explanation.text}</p>
          <small>{explanation.notice}</small>
        </div>
      )}
    </section>
  );
}
