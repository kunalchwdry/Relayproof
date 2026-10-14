import { nimChat, NIM_MODELS, MAX_OCR_FRAMES, MAX_FRAME_DATA_URL_CHARS, httpError, errorResponse, sendJson } from '../../lib/nim.js';

const DATA_URL = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;

function cleanFrames(input) {
  const frames = input?.frames;
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > MAX_OCR_FRAMES) {
    throw httpError(400, `Send between 1 and ${MAX_OCR_FRAMES} sampled frames.`);
  }
  return frames.map((frame, index) => {
    const dataUrl = typeof frame?.dataUrl === 'string' ? frame.dataUrl : '';
    const timestamp = Number(frame?.timestampSeconds);
    if (!DATA_URL.test(dataUrl) || dataUrl.length > MAX_FRAME_DATA_URL_CHARS) throw httpError(400, `Frame ${index + 1} is not a small JPEG or PNG image.`);
    if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 86_400) throw httpError(400, `Frame ${index + 1} has an invalid timestamp.`);
    return { index, dataUrl, timestampSeconds: Math.round(timestamp * 1000) / 1000 };
  });
}

async function readFrame(frame) {
  try {
    const text = await nimChat({
      model: NIM_MODELS.vision,
      maxTokens: 120,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Read ONLY the text that is literally visible in this video frame, verbatim, one line per text block. Do not describe the image, do not add greetings, disclaimers, notes, or any text that is not visible. If you cannot clearly read any text, output exactly NONE.' },
          { type: 'image_url', image_url: { url: frame.dataUrl } },
        ],
      }],
    });
    let cleaned = text.trim() === 'NONE' ? '' : text.trim();
    // Vision models sometimes append commentary after the visible text; keep only the first block.
    cleaned = cleaned.split(/\n\s*\n|Please note|Note:|This image|The image/i)[0].trim().slice(0, 400);
    return { index: frame.index + 1, timestampSeconds: frame.timestampSeconds, text: cleaned, meanOcrConfidence: null, error: null };
  } catch (error) {
    return { index: frame.index + 1, timestampSeconds: frame.timestampSeconds, text: '', meanOcrConfidence: null, error: error.message?.slice(0, 160) || 'OCR failed' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { detail: 'Use POST.' });
  try {
    const frames = cleanFrames(req.body);
    const results = [];
    // Small batches keep free-tier rate limits and function timeouts comfortable.
    for (let start = 0; start < frames.length; start += 2) {
      results.push(...await Promise.all(frames.slice(start, start + 2).map(readFrame)));
    }
    return sendJson(res, 200, { frames: results, model: NIM_MODELS.vision, notice: 'Frame text was read by an AI vision model on NVIDIA NIM. Check it against the frames.' });
  } catch (error) {
    return errorResponse(res, error);
  }
}
