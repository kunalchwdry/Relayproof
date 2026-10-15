// Builds the JSON report for one analysed clip. Pure: no DOM, so it can be tested.
// Frame pictures are left out (they are large); each frame's timestamp and findings are kept.
import { formatTime } from './findings.js';

export const REPORT_VERSION = 1;

export const REPORT_NOTICES = [
  'Findings are leads for a person to check against the clip. They are not proof of anything.',
  'AI-generated or deepfake content is not checked automatically. No free detector can do this reliably. Provenance (below) is the only authenticity signal.',
  'Content Credentials: "no credentials" is not evidence either way. Credentials only describe the file as its signer states.',
  'Claims are checked against published fact checks or live web search where configured. Verify important findings at the sources.',
];

export function reportFileName(clipName, generatedAt) {
  const base = String(clipName || 'clip').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'clip';
  const stamp = String(generatedAt || '').replace(/[:.]/g, '-').slice(0, 19) || 'report';
  return `relayproof-${base}-${stamp}.json`;
}

export function buildReport({ clipName, clipBytes = 0, result, findings, generatedAt = new Date().toISOString() }) {
  const frames = result?.frames || [];
  const alerts = findings?.alerts || [];
  const reviews = findings?.reviews || [];
  const duration = Number(result?.duration) || 0;
  return {
    reportVersion: REPORT_VERSION,
    generatedAt,
    tool: 'RelayProof video analysis',
    clip: {
      name: String(clipName || ''),
      sizeBytes: Number(clipBytes) || 0,
      durationSeconds: Math.round(duration * 100) / 100,
      durationLabel: formatTime(duration),
    },
    settings: {
      framesAnalysed: frames.length,
      transcriptSource: result?.transcriptSource || 'none',
      speechModel: result?.transcriptSource === 'speech' ? 'Whisper tiny (in-browser, English)' : null,
      frameSelection: 'scene changes plus even coverage, up to 16 frames',
    },
    summary: findings?.summary || null,
    provenance: result?.provenance || null,
    alerts: alerts.map(alert => ({
      at: alert.at ?? null,
      time: alert.at == null ? null : formatTime(alert.at),
      severity: alert.severity,
      title: alert.title,
      description: alert.description,
    })),
    reviewItems: reviews.map(item => ({
      at: item.at ?? null,
      time: item.at == null ? null : formatTime(item.at),
      title: item.title,
      severity: item.severity,
      description: item.description,
    })),
    claims: (result?.text?.claims || []).map(claim => ({
      claim: claim.claim,
      verdict: claim.verdict,
      reason: claim.reason,
      logicIssue: claim.logicIssue || null,
      evidenceSource: claim.evidenceSource || 'none',
      evidenceLabel: claim.evidenceLabel || null,
      sources: (claim.sources || []).map(({ title, link }) => ({ title, link })),
    })),
    frames: frames.map(frame => ({
      at: frame.timestampSeconds,
      time: formatTime(frame.timestampSeconds),
      onScreenText: frame.onScreenText || '',
      issues: (frame.issues || []).map(({ category, severity, description }) => ({ category, severity, description })),
      error: frame.error || null,
    })),
    speech: result?.transcriptSource === 'speech'
      ? (result.speech || []).map(segment => ({ start: segment.start, end: segment.end, text: segment.text }))
      : null,
    speechError: result?.speechError || null,
    speechNotice: result?.speechNotice || null,
    notices: REPORT_NOTICES,
  };
}
