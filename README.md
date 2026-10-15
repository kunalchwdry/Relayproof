# RelayProof

Voice and media provenance studio. Issue a signed claim for an audio or video file, then check a file against its sidecar, all in the browser. The app also has a video analysis page that flags visual and spoken problems, reads Content Credentials (C2PA), and shows pop-up alerts for high-priority findings, with results per moment.

## Run it locally

```bash
npm ci
cp .env.example .env.local      # then fill in the server-side keys
npm run dev                     # http://localhost:5173
```

Keys are read on the server only, from `.env.local` (Vite loads them for the dev middleware). Never put them in a `VITE_` variable. Optional keys:

- `NVIDIA_API_KEY`: frame reading, text safety, and claim judgement. Without it the analysis shows a plain "not available" message.
- `FACT_CHECK_API_KEY`: Google Fact Check Tools, checked first for claims (free within standard quota).
- `SERPAPI_KEY`: live web search, used for claims when no published fact check matches.

## Tests

```bash
npm run test:analysis      # findings, captions, frame choice, retries, cancel, provenance, report, media checks
npm run test:nim           # NVIDIA routes: request validation, evidence order
node --test test/bundle-secrets.test.mjs
npm run build
npm run scan:bundle        # fails if a credential is found in dist/
npm run test:e2e           # browser test of the analysis page: cancel, full run, pop-up keys, report export (NVIDIA mocked)
npm run test:e2e:silent    # clip with no sound track (needs RELAYPROOF_VIDEO=test/fixtures/silent-video.mp4)
npm run test:e2e:nim-down  # NVIDIA unavailable message
npm run test:e2e:blank     # all-black clip is stopped before any frame is sent
npm run verify:speech -- clip.wav   # runs the in-browser speech model on a 16 kHz mono WAV, outside the browser
```

The browser tests need `RELAYPROOF_URL` (for example `http://127.0.0.1:4173/` after `npm run build` and `npx vite preview`) and `RELAYPROOF_VIDEO`. The GitHub Actions workflow `.github/workflows/ci.yml` runs all of this on every push.

## Documentation

- [docs/ANALYSIS.md](docs/ANALYSIS.md): how video analysis works, what raises alerts, what was tested, and what is not verified.
- [docs/PATH_TO_8_5.md](docs/PATH_TO_8_5.md): the scoring rubric and the plan for the next stage.
- [GO_TO_MARKET.md](GO_TO_MARKET.md): market and go-to-market notes.
- [THREAT_MODEL.md](THREAT_MODEL.md): what the signatures do and do not prove.
- [LIVE_VERIFIER.md](LIVE_VERIFIER.md): the optional local media backend (Whisper, Chromaprint, OCR).

## Limits

Everything produced by the AI steps is a lead for a person to check, not a verdict on authenticity. There is no reliable free check for AI-generated or deepfake content; provenance (Content Credentials) is the only authenticity signal, and "no credentials" is not evidence either way. Speech in the browser is opt-in and not verified in a browser on a low-memory machine; paste a transcript for long or non-English clips.
