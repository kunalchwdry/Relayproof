// Calls one of the /api/nim routes and returns the parsed JSON.
// Retries once on a network error or a timeout or overload from the server. Model calls are often slow for a moment, not broken.
export const RETRYABLE = new Set([408, 429, 502, 503, 504]);

export async function postJson(url, body, { attempts = 2, delayMs = 2000, fetchImpl = globalThis.fetch } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let retry = false;
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      lastError = new Error(payload.detail || `The analysis service returned HTTP ${response.status}.`);
      retry = RETRYABLE.has(response.status);
    } catch {
      lastError = new Error('Could not reach the analysis service. Check your connection.');
      retry = true;
    }
    if (!retry) throw lastError;
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
  }
  throw lastError;
}
