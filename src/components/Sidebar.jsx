import React from 'react';
import Icon from './Icons.jsx';

const items = [
  { id: 'verify', label: 'Verify a clip', icon: 'verify' },
  { id: 'issue', label: 'Issue credential', icon: 'issue' },
  { id: 'archive', label: 'Credential archive', icon: 'archive' },
  { id: 'analyze', label: 'Analyse video', icon: 'verify' },
  { id: 'review', label: 'Review audio / video', icon: 'check' },
];

export default function Sidebar({ view, onNavigate, count }) {
  return (
    <aside className="sidebar">
      <button className="brand" type="button" aria-label="RelayProof home" onClick={() => onNavigate('verify')}>
        <span className="brand-mark"><Icon name="brand" size={23} /></span>
        <span>
          <span className="brand-name">relay<span>proof</span></span>
          <span className="brand-sub">Voice provenance studio</span>
        </span>
      </button>
      <div className="rail-label">Workspace</div>
      <nav className="rail-nav" aria-label="Main navigation">
        {items.map(item => (
          <button
            key={item.id}
            className={`nav-item${view === item.id ? ' active' : ''}`}
            type="button"
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} size={17} />
            {item.label}
            {item.id === 'archive' && <span className="nav-count">{String(count).padStart(2, '0')}</span>}
          </button>
        ))}
      </nav>
      <div className="rail-bottom">
        <div className="network-card">
          <div className="network-title">Current capability</div>
          <div className="network-row"><span className="local-status-dot" /> Local crypto <span className="network-chip">STAGE 1</span></div>
          <div className="network-foot">No SBR API or Monad RPC connected</div>
        </div>
        <div className="rail-note">Evidence that travels · 2026</div>
      </div>
    </aside>
  );
}
