// Calls one of the /api/nim routes and returns the parsed JSON.
// Retries once on a network error, a timeout, or an overload from the server: model calls are often slow for a moment, not broken.
// Pass an AbortSignal to cancel: the request, and any wait before a retry, stop at once with an AbortError.
export const RETRYABLE = new Set([408, 429, 502, 503, 504]);

export function cancelledError() {
  const error = new Error('Analysis cancelled.');
  error.name = 'AbortError';
  return error;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelledError()); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(cancelledError()); }, { once: true });
  });
}

// Errors carry the HTTP status (or undefined for a network failure), so the page can give a specific message.
export async function postJson(url, body, { attempts = 2, delayMs = 2000, fetchImpl = globalThis.fetch, signal } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw cancelledError();
    let retry = false;
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      lastError = new Error(payload.detail || `The analysis service returned HTTP ${response.status}.`);
      lastError.status = response.status;
      retry = RETRYABLE.has(response.status);
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw cancelledError();
      lastError = new Error('Could not reach the analysis service. Check your connection.');
      retry = true;
    }
    if (!retry) throw lastError;
    if (attempt < attempts) await sleep(delayMs * attempt, signal);
  }
  throw lastError;
}
