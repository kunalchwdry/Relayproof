# RelayProof

Voice and media provenance studio. Issue a signed claim for an audio or video file, then check a file against its sidecar, all in the browser. The app also has a video analysis page that flags visual and spoken problems, with pop-up alerts for high-priority findings.

## Run it locally

```bash
npm ci
cp .env.example .env.local      # then fill in the server-side keys
npm run dev                     # http://localhost:5173
```

Keys are read on the server only. Set `NVIDIA_API_KEY` and `SERPAPI_KEY` in `.env.local` (Vite loads them for the dev middleware); never put them in a `VITE_` variable.

## Tests

```bash
npm run test:credentials
npm run test:analysis
npm run test:nim
npm run test:extension
```

## Documentation

- [docs/ANALYSIS.md](docs/ANALYSIS.md): how video analysis works, what raises alerts, and what is not built yet (in-browser speech and deepfake models).
- [GO_TO_MARKET.md](GO_TO_MARKET.md): market and go-to-market notes.
- [THREAT_MODEL.md](THREAT_MODEL.md): what the signatures do and do not prove.
- [LIVE_VERIFIER.md](LIVE_VERIFIER.md): the optional local media backend (Whisper, Chromaprint, OCR).

## Limits

Everything produced by the AI steps is a lead for a person to check, not a verdict on authenticity. Deepfake detection is not yet connected, and speech needs a transcript unless it is run locally.
