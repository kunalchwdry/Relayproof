import React from 'react';

const labels = { verify: 'Verify a clip', issue: 'Issue credential', archive: 'Credential archive', review: 'SEBI content preflight' };

export default function Topbar({ view, onTrust }) {
  return (
    <header className="topbar">
      <div className="breadcrumb"><span>Provenance studio</span><span>/</span><strong>{labels[view]}</strong></div>
      <div className="topbar-right">
        <button className="top-link" type="button" onClick={onTrust}>How trust works</button>
        <div className="top-network"><span className="local-status-dot" /> LOCAL ECDSA <span style={{ color: '#b9a077' }}>·</span> NO CHAIN</div>
      </div>
    </header>
  );
}
