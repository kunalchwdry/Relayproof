import { nimChat, webSearch, serpApiKey, NIM_SAFETY_MODEL, NIM_TEXT_MODEL, MAX_ANALYSIS_TEXT_CHARS, httpError, errorResponse, sendJson, parseJsonLoose } from '../../lib/nim.js';
import { searchFactChecks, factCheckKey } from '../../lib/factcheck.js';
import { gatherEvidence } from '../../lib/evidence.js';

const MAX_CLAIMS = 4;
const VERDICTS = ['supported', 'contradicted', 'misleading', 'unverifiable'];

async function safetyCheck(text) {
  try {
    const raw = await nimChat({
      model: NIM_SAFETY_MODEL,
      maxTokens: 120,
      temperature: 0,
      messages: [{ role: 'user', content: text.slice(0, 4000) }],
    });
    const unsafe = /unsafe/i.test(raw) && !/user safety:\s*safe/i.test(raw);
    const categories = (raw.match(/categories?:\s*(.+)/i)?.[1] || '').split(/[,;]/).map(s => s.trim()).filter(Boolean).slice(0, 6);
    return { status: unsafe ? 'unsafe' : 'safe', categories, raw: raw.slice(0, 200), error: null };
  } catch (error) {
    return { status: 'unavailable', categories: [], raw: '', error: error.message?.slice(0, 160) };
  }
}

async function extractClaims(text) {
  const raw = await nimChat({
    model: NIM_TEXT_MODEL,
    maxTokens: 700,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `You extract checkable content from a video transcript and on-screen text. Return ONLY JSON:
{"claims": [{"claim": string, "searchQuery": string}], "schemeFlags": [{"flag": string, "quote": string}]}
- claims: up to ${MAX_CLAIMS} concrete factual statements that could be true or false (numbers, dates, named facts, scientific or financial claims). Skip opinions. searchQuery: a short web search that would verify it.
- schemeFlags: signs of a scam or fraud pattern: guaranteed or unrealistic returns, urgency, requests to send money or share OTPs, impersonating an official body, "risk-free" investment language. Quote the exact words.
- Empty arrays are fine.`,
      },
      { role: 'user', content: text },
    ],
  });
  const parsed = parseJsonLoose(raw) || {};
  const claims = (Array.isArray(parsed.claims) ? parsed.claims : [])
    .filter(c => c && typeof c.claim === 'string' && c.claim.trim())
    .slice(0, MAX_CLAIMS)
    .map(c => ({ claim: c.claim.slice(0, 300), searchQuery: String(c.searchQuery || c.claim).slice(0, 200) }));
  const schemeFlags = (Array.isArray(parsed.schemeFlags) ? parsed.schemeFlags : [])
    .filter(f => f && typeof f.flag === 'string')
    .slice(0, 8)
    .map(f => ({ flag: f.flag.slice(0, 160), quote: String(f.quote || '').slice(0, 240) }));
  return { claims, schemeFlags };
}

async function judgeClaim(claim, sources) {
  const evidence = sources.length
    ? sources.map((s, i) => `[${i + 1}] ${s.title} (${s.link})\n${s.snippet}`).join('\n\n')
    : 'No search results were available.';
  const raw = await nimChat({
    model: NIM_TEXT_MODEL,
    maxTokens: 300,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `You judge one factual claim using ONLY the search snippets provided. Return ONLY JSON:
{"verdict": "supported" | "contradicted" | "misleading" | "unverifiable", "reason": string, "logicIssue": string | null}
- "supported": the snippets clearly back the claim. "contradicted": the snippets clearly disagree. "misleading": partly true but missing context. "unverifiable": the snippets do not address it or none were given.
- Also check internal logic (e.g. guaranteed high returns with no risk), and put a short description in logicIssue, else null.
- Name a source only if it appears in the snippets. Do not use outside knowledge.
- Be conservative. Keep reason under 45 words.`,
      },
      { role: 'user', content: `Claim: ${claim}\n\nSearch snippets:\n${evidence}` },
    ],
  });
  const parsed = parseJsonLoose(raw) || {};
  return {
    verdict: VERDICTS.includes(parsed.verdict) ? parsed.verdict : 'unverifiable',
    reason: String(parsed.reason || 'The judgement could not be parsed; treat as unverified.').slice(0, 300),
    logicIssue: parsed.logicIssue ? String(parsed.logicIssue).slice(0, 240) : null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { detail: 'Use POST.' });
  try {
    const transcript = String(req.body?.transcript || '').trim();
    const onScreenText = String(req.body?.onScreenText || '').trim();
    const combined = [transcript && `Transcript:\n${transcript}`, onScreenText && `On-screen text:\n${onScreenText}`].filter(Boolean).join('\n\n');
    if (!combined) throw httpError(400, 'Provide a transcript or on-screen text to analyse.');
    if (combined.length > MAX_ANALYSIS_TEXT_CHARS) throw httpError(413, 'The text is too long; analyse a shorter clip.');

    const [safety, extracted] = await Promise.all([safetyCheck(combined), extractClaims(combined)]);

    const claims = [];
    for (const item of extracted.claims) {
      // Published fact checks first, then live web search. Each claim records which one was used.
      const evidence = await gatherEvidence(item.claim, { factCheck: searchFactChecks, webSearch, limit: 3 });
      const judgement = await judgeClaim(item.claim, evidence.snippets);
      claims.push({
        claim: item.claim,
        ...judgement,
        evidenceSource: evidence.evidenceSource,
        evidenceLabel: evidence.evidenceLabel,
        searchUsed: evidence.searchUsed,
        searchError: evidence.searchError,
        sources: evidence.sources,
      });
    }

    const anyEvidence = Boolean(serpApiKey() || factCheckKey());
    return sendJson(res, 200, {
      safety,
      schemeFlags: extracted.schemeFlags,
      claims,
      liveSearch: anyEvidence,
      factCheckConfigured: Boolean(factCheckKey()),
      notice: anyEvidence
        ? 'Claims were checked against published fact checks or live web search snippets by an AI model. Verify important findings at the sources.'
        : 'No evidence source is configured, so claims are unverifiable here. The model did not check them against the web.',
    });
  } catch (error) {
    return errorResponse(res, error);
  }
}
