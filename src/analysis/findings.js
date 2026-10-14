// Turns raw model output into the findings the user sees: pop-up alerts (high-stakes),
// review items (leads to check), and claim verdicts. Pure functions, no DOM, so they can be tested.

export const ALERT_CATEGORIES = {
  illegal_content: 'Illegal content',
  violence: 'Graphic violence',
  sexual_content: 'Sexual content',
  scam_or_fraud: 'Scam or fraud visual',
};

export const REVIEW_CATEGORIES = {
  visual_inconsistency: 'Visual inconsistency',
  possible_synthetic_artifacts: 'Possible synthetic artifacts (low confidence)',
  other: 'Other',
};

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

export function formatTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// frames: [{ timestampSeconds, onScreenText, issues: [{category, severity, description}] }]
// text:   { safety: {status, categories}, schemeFlags: [{flag, quote}], claims: [{claim, verdict, reason, logicIssue, sources}] }
export function buildFindings(frames = [], text = null) {
  const alerts = [];
  const reviews = [];

  for (const frame of frames) {
    for (const issue of frame.issues || []) {
      const item = {
        at: frame.timestampSeconds,
        category: issue.category,
        severity: issue.severity,
        description: issue.description,
      };
      if (ALERT_CATEGORIES[issue.category] && SEVERITY_RANK[issue.severity] >= SEVERITY_RANK.medium) {
        alerts.push({ kind: 'visual', title: ALERT_CATEGORIES[issue.category], ...item });
      } else if (REVIEW_CATEGORIES[issue.category] || ALERT_CATEGORIES[issue.category]) {
        reviews.push({ kind: 'visual', title: REVIEW_CATEGORIES[issue.category] || ALERT_CATEGORIES[issue.category], ...item });
      }
    }
  }

  if (text?.safety?.status === 'unsafe') {
    alerts.push({
      kind: 'text',
      title: 'Unsafe content in speech or on-screen text',
      at: null,
      category: 'unsafe_text',
      severity: 'high',
      description: text.safety.categories?.length
        ? `Flagged categories: ${text.safety.categories.join(', ')}.`
        : 'The content-safety model flagged the text. Read the transcript and check it yourself.',
    });
  }

  for (const flag of text?.schemeFlags || []) {
    alerts.push({
      kind: 'text',
      title: 'Possible scam scheme',
      at: null,
      category: 'scam_scheme',
      severity: 'high',
      description: `${flag.flag}${flag.quote ? `: "${flag.quote}"` : ''}`,
    });
  }

  const claims = (text?.claims || []).map(claim => {
    const level = claim.verdict === 'contradicted' ? 'high' : claim.verdict === 'misleading' || claim.logicIssue ? 'medium' : 'low';
    return { ...claim, level };
  });
  for (const claim of claims) {
    if (claim.verdict === 'contradicted') {
      alerts.push({ kind: 'claim', title: 'Factually contradicted claim', at: null, category: 'fact', severity: 'high', description: `"${claim.claim}". ${claim.reason}` });
    }
    if (claim.logicIssue) {
      alerts.push({ kind: 'claim', title: 'Logic problem', at: null, category: 'logic', severity: 'high', description: `"${claim.claim}". ${claim.logicIssue}` });
    }
  }

  alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (a.at ?? 1e9) - (b.at ?? 1e9));
  return {
    alerts,
    reviews,
    claims,
    timelineMarks: [...alerts, ...reviews].filter(item => item.at != null).map(item => ({ at: item.at, severity: item.severity, title: item.title })),
    synthetic: reviews.filter(item => item.category === 'possible_synthetic_artifacts'),
    summary: {
      framesAnalysed: frames.length,
      highAlerts: alerts.filter(a => a.severity === 'high').length,
      claimsChecked: claims.length,
      contradicted: claims.filter(c => c.verdict === 'contradicted').length,
      supported: claims.filter(c => c.verdict === 'supported').length,
      unverifiable: claims.filter(c => c.verdict === 'unverifiable').length,
    },
  };
}
