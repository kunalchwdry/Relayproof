import React, { useMemo, useState } from 'react';
import Icon from './Icons.jsx';

export default function ArchiveView({ records, trustedKeys = [], onOpenReceipt, onUseCredential, onIssue }) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter(record => `${record.title} ${record.issuer} ${record.id} ${record.fileName} ${record.keyId}`.toLowerCase().includes(q));
  }, [records, query]);
  const distinctKeys = new Set(records.map(record => record.keyId || record.credential?.issuer?.keyId).filter(Boolean)).size;

  return (
    <section className="view active" aria-label="Signed credential archive">
      <div className="archive-header">
        <div className="page-intro"><div className="section-kicker">LOCAL ISSUANCE LOG &nbsp;·&nbsp; 03</div><h1>Credential archive.</h1><p>Signed sidecars issued in this browser. This list is not an on-chain registry; download and share a sidecar to transfer it.</p></div>
        <div className="archive-controls"><input className="archive-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search issuer or asset…" aria-label="Search archive" /><button type="button" className="btn-primary" onClick={onIssue}><Icon name="plus" size={14} /> Issue</button></div>
      </div>
      <div className="archive-summary">
        <div className="stat-card"><div className="stat-label">Signed credentials</div><div className="stat-value">{String(records.length).padStart(2, '0')}</div><div className="stat-foot">Public claims stored locally</div></div>
        <div className="stat-card"><div className="stat-label">Issuer keys used</div><div className="stat-value">{String(distinctKeys).padStart(2, '0')}</div><div className="stat-foot">Local browser key identities</div></div>
        <div className="stat-card"><div className="stat-label">Pinned keys</div><div className="stat-value">{String(trustedKeys.length).padStart(2, '0')}</div><div className="stat-foot">User-pinned on this device only</div></div>
      </div>
      <div className="archive-table-wrap">
        <table className="archive-table">
          <thead><tr><th>Asset / credential</th><th>Publisher claim</th><th>Format</th><th>State</th><th>Issued</th><th>Actions</th></tr></thead>
          <tbody>
            {visible.length ? visible.map(record => {
              const keyId = record.keyId || record.credential?.issuer?.keyId;
              const pinned = trustedKeys.some(key => key.keyId === keyId);
              return (
                <tr key={record.id}>
                  <td><div className="archive-title-cell">{record.title}</div><div className="archive-id">{record.id}</div></td>
                  <td>{record.issuer}</td><td>{record.format || 'Audio'}</td>
                  <td><span className="table-status pending"><span className="live-dot" />{pinned ? 'Key pinned here' : 'Signed · local'}</span></td>
                  <td>{record.date || '—'}</td>
                  <td><div className="archive-actions"><button className="table-action" type="button" onClick={() => onUseCredential(record)}>Verify ↗</button><button className="table-action" type="button" onClick={() => onOpenReceipt(record)}>JSON</button></div></td>
                </tr>
              );
            }) : <tr><td colSpan="6" className="empty-row">{records.length ? 'No records match this search.' : 'No signed credentials yet. Issue a local signed sidecar to get started.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="footer-note"><span>Local archive · no Monad calls</span><span>Export sidecars for sharing; browser data is not a backup.</span></div>
    </section>
  );
}
