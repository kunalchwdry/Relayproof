import { nimChat, NIM_MODELS, MAX_EXPLAIN_CHARS, httpError, errorResponse, sendJson } from '../../lib/nim.js';

const TEXT_FIELDS = ['status', 'fileName', 'signerName', 'issuerName', 'keyId', 'algorithm', 'createdAt', 'reason', 'similarity'];

function cleanFacts(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'Send a verification object.');
  const facts = {};
  for (const key of TEXT_FIELDS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'number' && Number.isFinite(value)) facts[key] = value;
    else if (typeof value === 'string') facts[key] = value.slice(0, 300);
    else if (typeof value === 'boolean') facts[key] = value;
  }
  for (const key of ['valid', 'digestMatches', 'trusted']) {
    if (typeof input[key] === 'boolean') facts[key] = input[key];
  }
  const serialized = JSON.stringify(facts);
  if (serialized.length > MAX_EXPLAIN_CHARS) throw httpError(413, 'Verification details are too large to explain.');
  return facts;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { detail: 'Use POST.' });
  try {
    const facts = cleanFacts(req.body);
    const messages = [
        {
          role: 'system',
          content: 'You explain the output of a local media provenance checker to a non-expert. Use ONLY the JSON facts provided; do not invent details. Field meanings: digestMatches = the file bytes equal the bytes the signed sidecar was issued for (it does NOT say who made the file or whether it is authentic). valid = the sidecar signature checks out. trusted = the signing key is one the user has pinned locally (it does NOT prove the issuer is reputable). Always state what the facts do not establish. Never say the media is real, authentic, safe, or from a specific person. Keep it under 120 words, plain English, no markdown headings.',
        },
        { role: 'user', content: `Verification facts (JSON):\n${JSON.stringify(facts)}` },
    ];
    let text = '';
    let usedModel = '';
    let lastError = null;
    for (const model of NIM_MODELS.explain) {
      try {
        text = await nimChat({ model, maxTokens: 350, temperature: 0.1, messages });
        usedModel = model;
        break;
      } catch (error) {
        lastError = error;
        if (error.status !== 404) break;   // only fall back when the model itself is unavailable
      }
    }
    if (!usedModel) throw lastError || httpError(502, 'No explanation model is available.');
    if (!text) throw httpError(502, 'NVIDIA NIM returned an empty explanation.');
    return sendJson(res, 200, { text, model: usedModel, notice: 'AI-written explanation of the check result, not a new verification. Verify the facts yourself.' });
  } catch (error) {
    return errorResponse(res, error);
  }
}
