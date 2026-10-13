# RelayProof competitor watch — setup and limits

This project now includes a repeatable, public-source competitor watcher. It checks selected GitHub repositories, issues, vendor/spec pages, and a few GitHub repository searches; it reports changes for a human to review. It does **not** use an AI or web-search API, and it does not automatically rewrite product positioning or mark a source as a confirmed competitor.

## Run it manually

From this project directory:

```bash
npm run watch:competitors
```

The script can also be run directly:

```bash
python3 scripts/competitor_watch.py
```

Run the offline regression tests for partial reports and state preservation with `npm run test:watch`.

Local checks use unauthenticated GitHub API access unless `GITHUB_TOKEN` is present in the environment; GitHub’s unauthenticated rate limit can make a scan partial. Use an appropriately scoped read token locally if needed, and never commit it.

A **complete** first run creates a complete baseline. Partial runs are labeled as partial, retain last-known values for failed sources, and do not replace them with empty data. `baseline_complete` stays false until all configured sources have responded successfully at least once; on later partial runs, the report limits any “no changes” statement to sources that were actually checked.

- Watchlist: `competitor-watchlist.json`
- Saved baseline: `data/competitor-watch-state.json`
- Latest report: `reports/competitor-watch/latest.md`
- Curated human-written comparison: `COMPETITOR_COMPARISON.md`

Edit the JSON watchlist to add or remove repositories, vendor pages, GitHub issues, or search queries. When a new search candidate is manually confirmed as relevant, add its repository to the `repos` list so future commits are tracked.

## Weekly unattended checks (requires publishing this project to GitHub)

`.github/workflows/competitor-watch.yml` is configured to run every Monday at 07:25 UTC (12:55 PM Pune time), and can also be run through **Actions → RelayProof competitor watch → Run workflow**.

For the schedule to operate:

1. Push this project to a GitHub repository and include the workflow on its default branch.
2. Enable GitHub Actions for the repository.
3. Allow the workflow's `GITHUB_TOKEN` to write repository contents and issues. The workflow uses those permissions to persist the baseline/report and open an issue when it detects a change. Branch protection that blocks direct workflow commits will need a PR-based adaptation.
4. Review any issue as a lead, not as a confirmed competitor. Close or edit it after checking whether the change is substantive.

The scheduled job uses only public GitHub and page endpoints. `GITHUB_TOKEN` is supplied by Actions; for local runs it is optional. The workflow uploads each run's report as an artifact. It only opens an issue when it detects changes or a newly surfaced repository candidate. GitHub notification delivery depends on the repository owner's notification settings.

## What it watches

Watchlist v3 contains 19 repositories, 2 tracked issues, 8 product/spec pages, and 5 repository-search queries. It includes Grain and Origo (public Metropolis media-provenance projects); provcheck, AudioTrust, Cassini Format, Neutral TTS Workbench, audiofp, RedoSan Authenticity, C2PA Inspector, Provenance Lens, EM-Audio, Digimarc’s C2PA extension, and a soft-bindings benchmark; upstream AudioSeal/C2PA resources; Sussurro implementation issues; AIWatermark, Resemble, AWS, OpenAI, ContentLens, and the official Metropolis page. Repository roles are triage notes, not capability guarantees. It also runs five bounded GitHub repository searches: Metropolis Track 04, AudioSeal, Opus audio provenance, C2PA audio, and general audio provenance. Each query returns a top-ten sample; broad queries will include irrelevant leads.

## Current artifact status

The saved local run in `reports/competitor-watch/latest.md` and `data/competitor-watch-state.json` is **partial and rate-limited**: unauthenticated GitHub API calls returned HTTP 403, so it is not a complete baseline. The watcher code now preserves successful observations, records `baseline_complete`, and reports incomplete scans explicitly. Run it again after the GitHub limit resets or from the authenticated Actions workflow to populate the expanded watchlist. Do not treat the older report’s “no changes” wording as a market conclusion.

## Important limits

- This is **not active monitoring until the workflow is pushed to GitHub**. The current workspace cannot send future alerts on its own.
- GitHub search returns only a limited top-ten sample per query and cannot prove that a project is a hackathon entrant.
- A repository commit may be documentation-only; a changed web-page fingerprint may be cookie/marketing churn. Every alert needs manual review.
- The script tracks public source changes; it does not establish feature quality, test claims, user demand, or technical correctness.
- It does not automatically edit `COMPETITOR_COMPARISON.md`. Keep that report curated and evidence-based.
- A **complete** initial run creates the baseline; partial first runs remain explicitly incomplete until coverage is filled. Later runs report changes from the saved observations, and newly populated baseline entries are not retroactively labelled as new competitors.
