const RULES = [
  {
    id: 'return-promise',
    severity: 'high',
    area: 'Returns / performance',
    pattern: /\b(?:guarantee(?:d)?|assured|risk[ -]?free|sure[ -]?shot|no[ -]?loss|fixed[ -]?return|double (?:your|the) (?:money|investment)|100\s*%\s*(?:accuracy|returns?|profit))\b/i,
    title: 'Return or accuracy promise language',
    detail: 'This wording may be misleading or prohibited in some regulated communications. Check the exact context, applicable rule set, and supporting evidence with a qualified compliance reviewer.',
  },
  {
    id: 'authority-claim',
    severity: 'high',
    area: 'Registration / endorsement',
    pattern: /\bSEBI[ -]?(?:approved|endorsed|guaranteed|certified|backed)\b/i,
    title: 'Possible SEBI endorsement claim',
    detail: 'A claim of SEBI approval or endorsement needs careful review. A registration number, if present, is not proof that a specific video, product, return, or recommendation was approved.',
  },
  {
    id: 'specific-recommendation',
    severity: 'review',
    area: 'Security-specific advice',
    pattern: /\b(?:buy|sell|hold|accumulate|strong buy|target price|stop[ -]?loss|entry price|exit price|my recommendation|I recommend|we recommend)\b/i,
    title: 'Possible security recommendation or trading call',
    detail: 'Review whether the content is security-specific research/advice, who is publishing it, registration and conduct requirements, and whether any client-specific suitability obligations apply.',
  },
  {
    id: 'performance-statistic',
    severity: 'review',
    area: 'Performance claims',
    pattern: /(?:₹\s?\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?\s?(?:%|percent|x\b|times\b|bps\b|basis points?\b|crore\b|lakh\b))/i,
    title: 'Numeric or return-related claim needs a source',
    detail: 'Check the figure, period, calculation, benchmark, assumptions, and required disclosures against primary records. This scan cannot validate a number.',
  },
  {
    id: 'public-offer',
    severity: 'review',
    area: 'IPO / public issue',
    pattern: /\b(?:IPO|initial public offering|public issue|offer document|price band|red herring prospectus|RHP|DRHP)\b/i,
    title: 'Public-issue information detected',
    detail: 'For public-issue content, compare material statements with the applicable offer document and price-band advertisement; verify the required audiovisual disclosures for the exact role and communication.',
  },
  {
    id: 'paid-promotion',
    severity: 'review',
    area: 'Promotion / association',
    pattern: /\b(?:sponsor(?:ed|ship)?|paid partnership|affiliate link|referral fee|commission|promoted by|brand partner)\b/i,
    title: 'Possible paid or promotional relationship',
    detail: 'Check the speaker’s role, the regulated entity’s relationship with the creator, and all applicable advertising/association and disclosure requirements. On-screen disclosures are not inspected by this text scan.',
  },
];

function splitSentences(text) {
  return text
    .replace(/\r/g, '\n')
    .split(/(?<=[.!?।])\s+|\n+/u)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0);
}

export function runSebiPreflight(transcript, { publisherRole = 'unknown' } = {}) {
  const text = String(transcript || '').normalize('NFKC');
  const sentences = splitSentences(text);
  const flags = [];

  for (const rule of RULES) {
    const matches = sentences.filter(sentence => rule.pattern.test(sentence));
    if (matches.length) {
      flags.push({
        id: rule.id,
        severity: rule.severity,
        area: rule.area,
        title: rule.title,
        detail: rule.detail,
        examples: matches.slice(0, 3),
        matchCount: matches.length,
      });
    }
  }

  // This is a deliberately narrow “evidence needed” extractor, not a complete fact checker.
  const evidencePattern = /(?:₹\s?\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?\s?(?:%|percent|x\b|times\b|bps\b|basis points?\b|crore\b|lakh\b)|\b(?:20\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b|\b(?:NIFTY|SENSEX|BANKNIFTY|IPO|DRHP|RHP)\b)/i;
  const claimsNeedingEvidence = sentences.filter(sentence => evidencePattern.test(sentence)).slice(0, 20);

  const registrationMention = /\b(?:SEBI\s*(?:registration|registered)|registered\s+(?:research analyst|investment adviser)|RA\s*registration|IA\s*registration)\b/i.test(text);
  const riskMention = /\b(?:risk|loss|capital at risk|past performance|market risk)\b/i.test(text);

  return {
    status: flags.length ? 'review-required' : 'no-obvious-flags',
    publisherRole,
    flags,
    claimsNeedingEvidence,
    checks: {
      transcriptKeywordScan: 'complete',
      factualClaimsVerified: false,
      registrationVerified: false,
      visualDisclosuresChecked: false,
      audioVideoTranscribedAutomatically: false,
      riskLanguageMentioned: riskMention,
      registrationLanguageMentioned: registrationMention,
    },
    limitations: [
      'This is a phrase-level preflight, not a legal opinion, exhaustive SEBI rule engine, or SEBI approval.',
      'It does not establish whether statements are true. Numeric/date/security claims need comparison with dated primary sources.',
      'It does not verify the speaker, publisher, SEBI registration number, eligibility, or any registration status.',
      'It only scans the transcript text supplied by the user; it does not inspect on-screen text, charts, logos, visual disclosures, edits, or tone.',
      'It does not understand every language, negation, quotation, satire, or context; a detected phrase is a review flag, not a finding of violation.',
    ],
  };
}

export const SEBI_REFERENCE_LINKS = [
  {
    label: 'SEBI master circulars (including current IA / RA circular listings)',
    url: 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=6&smid=0',
  },
  {
    label: 'SEBI circular on association with certain persons (22 Oct 2024)',
    url: 'https://www.sebi.gov.in/legal/circulars/oct-2024/association-of-persons-regulated-by-the-board-and-their-agents-with-certain-persons_87837.html',
  },
  {
    label: 'SEBI ICDR Master Circular (public-issue / audiovisual disclosure provisions)',
    url: 'https://www.sebi.gov.in/sebi_data/attachdocs/feb-2026/1770636136785.pdf',
  },
  {
    label: 'SEBI investor caution: unregistered investment advisers',
    url: 'https://investor.sebi.gov.in/cautiontoinvestor.html',
  },
];

export const SEBI_PREFLIGHT_RULE_COUNT = RULES.length;
