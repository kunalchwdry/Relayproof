// Server-side NVIDIA NIM client. The API key is read from the environment only;
// it is never returned to the browser and never written into the bundle.
export const NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export const NIM_MODELS = {
  // Verified on this account: these answer; several other catalog models return 404.
  explain: ['meta/llama-3.2-90b-vision-instruct', 'meta/llama-3.2-11b-vision-instruct'],
  vision: 'meta/llama-3.2-11b-vision-instruct',
};

export const MAX_OCR_FRAMES = 8;
export const MAX_FRAME_DATA_URL_CHARS = 700_000;   // ~520 KB JPEG per frame, base64-encoded
export const MAX_EXPLAIN_CHARS = 4_000;

export function nimKey() {
  return (process.env.NVIDIA_API_KEY || '').trim();
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function nimChat({ model, messages, maxTokens = 400, temperature = 0.2, timeoutMs = 45_000 }) {
  const key = nimKey();
  if (!key) throw httpError(503, 'NVIDIA NIM is not configured on the server (NVIDIA_API_KEY is missing).');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: false }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const upstream = String(data?.error?.message || data?.detail || '').slice(0, 200);
      const status = response.status === 429 ? 429 : 502;
      throw httpError(status, `NVIDIA NIM (${model}) returned HTTP ${response.status}${upstream ? `: ${upstream}` : ''}`);
    }
    return String(data?.choices?.[0]?.message?.content ?? '').trim();
  } catch (error) {
    if (error?.name === 'AbortError') throw httpError(504, 'NVIDIA NIM did not answer in time. Try again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Minimal wrapper so the same handlers work in Vercel and in the Vite dev middleware.
export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function errorResponse(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  // Upstream messages are short and never include the key; only hide unexpected server errors.
  sendJson(res, status, { detail: status === 500 ? 'The server could not complete this request.' : error.message });
}

// Models sometimes wrap JSON in prose or code fences; take the outermost object.
export function parseJsonLoose(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export const NIM_SAFETY_MODEL = 'nvidia/nemotron-3.5-content-safety';
export const NIM_TEXT_MODEL = 'meta/llama-3.2-90b-vision-instruct';
export const NIM_VISION_MODEL = 'meta/llama-3.2-11b-vision-instruct';
export const MAX_ANALYSIS_TEXT_CHARS = 12_000;

export function serpApiKey() {
  return (process.env.SERPAPI_KEY || '').trim();
}

// Free-tier SerpAPI Google search. Returns at most `limit` organic results.
export async function webSearch(query, limit = 3) {
  const key = serpApiKey();
  if (!key) return { available: false, results: [] };
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query.slice(0, 200));
  url.searchParams.set('num', String(limit));
  url.searchParams.set('api_key', key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { available: true, results: [], error: `search returned HTTP ${response.status}` };
    const data = await response.json();
    const results = (data.organic_results || []).slice(0, limit).map(item => ({
      title: String(item.title || '').slice(0, 160),
      link: String(item.link || '').slice(0, 300),
      snippet: String(item.snippet || '').slice(0, 300),
    }));
    return { available: true, results, error: null };
  } catch (error) {
    return { available: true, results: [], error: error?.name === 'AbortError' ? 'search timed out' : 'search failed' };
  } finally {
    clearTimeout(timer);
  }
}
