import { nimChat, NIM_VISION_MODEL, MAX_OCR_FRAMES, MAX_FRAME_DATA_URL_CHARS, httpError, errorResponse, sendJson, parseJsonLoose } from '../../lib/nim.js';

const DATA_URL = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const CATEGORIES = ['illegal_content', 'violence', 'sexual_content', 'scam_or_fraud', 'visual_inconsistency', 'possible_synthetic_artifacts', 'other'];

const PROMPT = `You review one frame from a video for a provenance and safety report.
Return ONLY a JSON object, no prose:
{"onScreenText": string, "issues": [{"category": one of ${CATEGORIES.join(', ')}, "severity": "low" | "medium" | "high", "description": string}]}
Rules:
- onScreenText: the text literally visible in the frame, verbatim. Empty string if none. Do not describe the scene.
- issues: only things clearly visible. Use [] if nothing is wrong. Examples: weapons or drugs shown (illegal_content), graphic violence, sexual content, a fake payment or guaranteed-return graphic (scam_or_fraud), physically impossible or contradictory visuals such as impossible text, broken logos, or mismatched labels (visual_inconsistency), obvious synthetic artifacts such as warped hands or smeared faces (possible_synthetic_artifacts, low confidence only).
- Never identify real people. Never claim a frame is real or fake.`;

async function analyzeFrame(frame) {
  try {
    const raw = await nimChat({
      model: NIM_VISION_MODEL,
      maxTokens: 500,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: frame.dataUrl } },
        ],
      }],
    });
    const parsed = parseJsonLoose(raw) || {};
    const issues = (Array.isArray(parsed.issues) ? parsed.issues : [])
      .filter(issue => issue && CATEGORIES.includes(issue.category))
      .slice(0, 6)
      .map(issue => ({
        category: issue.category,
        severity: ['low', 'medium', 'high'].includes(issue.severity) ? issue.severity : 'low',
        description: String(issue.description || '').slice(0, 240),
      }));
    return {
      timestampSeconds: frame.timestampSeconds,
      onScreenText: String(parsed.onScreenText || '').trim().slice(0, 400),
      issues,
      parsed: Object.keys(parsed).length > 0,
      error: null,
    };
  } catch (error) {
    return { timestampSeconds: frame.timestampSeconds, onScreenText: '', issues: [], parsed: false, error: error.message?.slice(0, 160) || 'frame analysis failed' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { detail: 'Use POST.' });
  try {
    const frames = req.body?.frames;
    if (!Array.isArray(frames) || frames.length < 1 || frames.length > MAX_OCR_FRAMES) {
      throw httpError(400, `Send between 1 and ${MAX_OCR_FRAMES} frames per request.`);
    }
    const clean = frames.map((frame, index) => {
      const dataUrl = typeof frame?.dataUrl === 'string' ? frame.dataUrl : '';
      const timestamp = Number(frame?.timestampSeconds);
      if (!DATA_URL.test(dataUrl) || dataUrl.length > MAX_FRAME_DATA_URL_CHARS) throw httpError(400, `Frame ${index + 1} is not a small JPEG or PNG image.`);
      if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 86_400) throw httpError(400, `Frame ${index + 1} has an invalid timestamp.`);
      return { dataUrl, timestampSeconds: Math.round(timestamp * 1000) / 1000 };
    });
    const results = [];
    for (let start = 0; start < clean.length; start += 2) {
      results.push(...await Promise.all(clean.slice(start, start + 2).map(analyzeFrame)));
    }
    return sendJson(res, 200, {
      frames: results,
      model: NIM_VISION_MODEL,
      notice: 'Frame findings are AI judgments from single frames. They are leads for a human reviewer, not proof.',
    });
  } catch (error) {
    return errorResponse(res, error);
  }
}
