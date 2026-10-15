// Chooses where the evidence for one claim comes from, in order:
// 1. Published fact checks (Google Fact Check Tools API), when configured and a match exists.
// 2. Live web search (SerpAPI), when configured. Used only when step 1 found nothing.
// 3. None. The claim is then reported as unverifiable.
// The dependencies are passed in so the order can be tested without network calls.

export async function gatherEvidence(claim, { factCheck, webSearch, limit = 3 }) {
  const checked = await factCheck(claim, { limit });
  if (checked.results.length) {
    return {
      evidenceSource: 'factcheck',
      evidenceLabel: 'Google Fact Check Tools (published fact checks)',
      searchUsed: true,
      searchError: null,
      snippets: checked.results.map(r => ({
        title: r.title,
        link: r.link,
        snippet: `Published fact check by ${r.publisher}${r.reviewDate ? ` (${r.reviewDate.slice(0, 10)})` : ''}. Rating: "${r.rating || 'not stated'}". Reviewed claim: "${r.claimText}".`,
      })),
      sources: checked.results.map(r => ({ title: `${r.publisher}: ${r.title}`, link: r.link })),
    };
  }
  const search = await webSearch(claim, limit);
  if (search.results.length) {
    return {
      evidenceSource: 'web',
      evidenceLabel: 'Live web search (SerpAPI)',
      searchUsed: search.available,
      searchError: search.error || checked.error || null,
      snippets: search.results,
      sources: search.results.map(({ title, link }) => ({ title, link })),
    };
  }
  return {
    evidenceSource: 'none',
    evidenceLabel: search.available || checked.available ? 'No matching sources found' : 'No evidence source configured',
    searchUsed: Boolean(search.available || checked.available),
    searchError: search.error || checked.error || null,
    snippets: [],
    sources: [],
  };
}
