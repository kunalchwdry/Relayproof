// Google Fact Check Tools API (free within standard quota). Searches published fact checks by claim text.
// Server-side only. The key comes from FACT_CHECK_API_KEY and is sent in a header, never in the URL.
export const FACT_CHECK_ENDPOINT = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';

export function factCheckKey() {
  return (process.env.FACT_CHECK_API_KEY || '').trim();
}

// Maps the API response to the few fields we use. Pure, so it can be tested with fixtures.
export function mapFactCheckResponse(json, limit = 3) {
  const results = [];
  for (const claim of Array.isArray(json?.claims) ? json.claims : []) {
    for (const review of Array.isArray(claim?.claimReview) ? claim.claimReview : []) {
      const link = String(review?.url || '');
      if (!/^https:\/\//.test(link)) continue;
      results.push({
        claimText: String(claim.text || '').slice(0, 300),
        rating: String(review.textualRating || '').slice(0, 120),
        publisher: String(review.publisher?.name || review.publisher?.site || 'Unknown publisher').slice(0, 120),
        title: String(review.title || claim.text || link).slice(0, 160),
        link: link.slice(0, 300),
        reviewDate: String(review.reviewDate || '').slice(0, 30),
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

// Returns { available, results, error }. Never throws: a failed lookup is reported, not hidden.
export async function searchFactChecks(query, { limit = 3, timeoutMs = 8_000, fetchImpl = globalThis.fetch } = {}) {
  const key = factCheckKey();
  if (!key) return { available: false, results: [], error: null };
  const url = new URL(FACT_CHECK_ENDPOINT);
  url.searchParams.set('query', String(query).slice(0, 200));
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(limit, 10))));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: { 'X-goog-api-key': key }, signal: controller.signal });
    if (!response.ok) return { available: true, results: [], error: `fact-check search returned HTTP ${response.status}` };
    const json = await response.json();
    return { available: true, results: mapFactCheckResponse(json, limit), error: null };
  } catch (error) {
    return { available: true, results: [], error: error?.name === 'AbortError' ? 'fact-check search timed out' : 'fact-check search failed' };
  } finally {
    clearTimeout(timer);
  }
}
