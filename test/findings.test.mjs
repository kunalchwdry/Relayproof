import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFindings, formatTime } from '../src/analysis/findings.js';

test('high-severity illegal visuals become pop-up alerts, sorted by severity then time', () => {
  const frames = [
    { timestampSeconds: 12, issues: [{ category: 'violence', severity: 'high', description: 'weapon shown' }] },
    { timestampSeconds: 3, issues: [{ category: 'scam_or_fraud', severity: 'medium', description: 'fake payment screen' }] },
    { timestampSeconds: 5, issues: [{ category: 'visual_inconsistency', severity: 'high', description: 'impossible sign text' }] },
  ];
  const out = buildFindings(frames, null);
  assert.deepEqual(out.alerts.map(a => a.at), [12, 3]);
  assert.equal(out.reviews.length, 1);
  assert.equal(out.reviews[0].title, 'Visual inconsistency');
});

test('low-severity illegal visuals are kept as review items, not pop-ups', () => {
  const out = buildFindings([{ timestampSeconds: 1, issues: [{ category: 'illegal_content', severity: 'low', description: 'maybe a logo' }] }]);
  assert.equal(out.alerts.length, 0);
  assert.equal(out.reviews.length, 1);
});

test('unsafe text, scheme flags and contradicted claims all raise high alerts', () => {
  const text = {
    safety: { status: 'unsafe', categories: ['Fraud'] },
    schemeFlags: [{ flag: 'guaranteed returns', quote: 'guaranteed 40%' }],
    claims: [
      { claim: 'The moon is cheese', verdict: 'contradicted', reason: 'It is rock.', logicIssue: null, sources: [] },
      { claim: 'Guaranteed returns with zero risk', verdict: 'unverifiable', reason: 'n/a', logicIssue: 'Guaranteed high return with no risk contradicts how investments work.', sources: [] },
    ],
  };
  const out = buildFindings([], text);
  const titles = out.alerts.map(a => a.title);
  assert.ok(titles.includes('Unsafe content in speech or on-screen text'));
  assert.ok(titles.includes('Possible scam scheme'));
  assert.ok(titles.includes('Factually contradicted claim'));
  assert.ok(titles.includes('Logic problem'));
  assert.equal(out.summary.contradicted, 1);
  assert.equal(out.summary.unverifiable, 1);
});

test('synthetic-artifact signals are never pop-ups on their own', () => {
  const frames = [{ timestampSeconds: 4, issues: [{ category: 'possible_synthetic_artifacts', severity: 'high', description: 'smeared face' }] }];
  const out = buildFindings(frames, null);
  assert.equal(out.alerts.length, 0);
  assert.equal(out.synthetic.length, 1);
});

test('clean input produces no alerts and formatTime works', () => {
  const out = buildFindings([{ timestampSeconds: 0, issues: [] }], { safety: { status: 'safe' }, schemeFlags: [], claims: [] });
  assert.equal(out.alerts.length, 0);
  assert.equal(formatTime(75.4), '1:15');
  assert.equal(formatTime(-3), '0:00');
});
