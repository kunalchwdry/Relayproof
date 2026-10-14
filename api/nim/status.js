import { nimKey, NIM_MODELS, sendJson } from '../../lib/nim.js';

export default function handler(req, res) {
  const configured = Boolean(nimKey());
  sendJson(res, 200, {
    ok: true,
    service: 'nvidia-nim-media-tools',
    configured,
    model: NIM_MODELS.vision,
    frameOcrAvailable: configured,
    frameOcrMessage: configured
      ? 'NVIDIA NIM vision OCR is ready. Sampled frames are sent to NVIDIA when you click scan.'
      : 'NVIDIA NIM is not configured on this server.',
    explainAvailable: configured,
    transcriptionAvailable: false,
  });
}
