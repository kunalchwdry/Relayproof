import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, reportFileName, REPORT_NOTICES } from '../src/analysis/report.js';
import { buildFindings } from '../src/analysis/findings.js';

const frames = [
  { timestampSeconds: 52, dataUrl: 'data:image/jpeg;base64,AAAA', onScreenText: 'Guaranteed returns', issues: [{ category: 'scam_or_fraud', severity: 'high', description: 'fake payment' }] },
  { timestampSeconds: 3, dataUrl: 'data:image/jpeg;base64,BBBB', onScreenText: '', issues: [] , error: null },
];
const text = {
  safety: { status: 'safe', categories: [] },
  schemeFlags: [{ flag: 'Guaranteed returns', quote: 'guaranteed 20%' }],
  claims: [{ claim: 'Water boils at 90 C', verdict: 'contradicted', reason: 'Sources say 100 C.', logicIssue: null, evidenceSource: 'factcheck', evidenceLabel: 'Google Fact Check Tools', sources: [{ title: 'Desk: water', link: 'https://example.org/c', snippet: 'secret-snippet-text' }] }],
};
const result = { frames, text, transcriptSource: 'typed', speech: null, speechError: null, duration: 156.4, provenance: { status: 'none', note: 'No Content Credentials were found.' } };
const findings = buildFindings(frames, text);

test('report has the clip, summary, alerts with times, claims with sources, and frames', () => {
  const report = buildReport({ clipName: 'walk.mp4', clipBytes: 1234, result, findings, generatedAt: '2026-10-15T10:00:00.000Z' });
  assert.equal(report.reportVersion, 1);
  assert.equal(report.clip.name, 'walk.mp4');
  assert.equal(report.clip.durationLabel, '2:36');
  assert.equal(report.summary.framesAnalysed, 2);
  assert.equal(report.alerts[0].time, '0:52');
  assert.equal(report.alerts[0].severity, 'high');
  assert.equal(report.claims[0].evidenceSource, 'factcheck');
  assert.equal(report.frames[1].time, '0:03');
  assert.equal(report.provenance.status, 'none');
});

test('report never contains frame pictures or raw search snippets', () => {
  const json = JSON.stringify(buildReport({ clipName: 'a.mp4', result, findings }));
  assert.ok(!json.includes('data:image'), 'frame pictures must not be exported');
  assert.ok(!json.includes('secret-snippet-text'), 'snippets are not part of the report');
});

test('report carries the notices, and the speech section is null unless speech was used', () => {
  const report = buildReport({ clipName: 'a.mp4', result, findings });
  assert.deepEqual(report.notices, REPORT_NOTICES);
  assert.equal(report.speech, null);
  const withSpeech = buildReport({ clipName: 'a.mp4', result: { ...result, transcriptSource: 'speech', speech: [{ start: 0, end: 4, text: 'hi' }] }, findings });
  assert.deepEqual(withSpeech.speech, [{ start: 0, end: 4, text: 'hi' }]);
  assert.equal(withSpeech.settings.speechModel, 'Whisper tiny (in-browser, English)');
});

test('an empty result still builds a valid report', () => {
  const report = buildReport({ clipName: '', result: null, findings: null });
  assert.equal(report.clip.name, '');
  assert.deepEqual(report.alerts, []);
  assert.equal(report.summary, null);
});

test('report file names are safe and dated', () => {
  assert.equal(reportFileName('My walk (final).mp4', '2026-10-15T10:20:30.000Z'), 'relayproof-My-walk-final-2026-10-15T10-20-30.json');
  assert.equal(reportFileName('', ''), 'relayproof-clip-report.json');
});
