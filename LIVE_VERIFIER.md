# RelayProof verifier — exact-byte credentials, optional Chromaprint candidate matching, and content preflight

## What is live now

The React/Vite app now issues and checks a RelayProof-specific signed JSON sidecar in the browser:

1. Choose an audio or video file (maximum 128 MB) and enter the publisher declaration.
2. Optionally opt in to a local Chromaprint fingerprint. Exact-only signing does not send media anywhere; if selected, the media is sent only to the self-hosted `/api/fingerprint` endpoint. For a video, Chromaprint covers audio only.
3. RelayProof computes SHA-256 over the entire file in the browser.
4. A non-extractable ECDSA P-256 key signs a `relayproof.media-credential.v1` sidecar, including the optional audio fingerprint if supplied. Existing audio v1 sidecars still verify.
5. Download the `.relayproof.json` sidecar and share it with the original media.
6. The recipient selects both files. RelayProof checks the signature and exact SHA-256; if the bytes differ and the sidecar has a fingerprint, the recipient may explicitly request a local audio-fingerprint candidate comparison.

The sidecar embeds the public key, key fingerprint, asset digest, media kind, claim fields, issuance date, signature, and optional Chromaprint reference. Exact-only issuance and verification run in the browser. Fingerprinting/comparison sends the selected media to the self-hosted backend only after explicit opt-in/click; for video, the audio track is fingerprinted but the visual frames are not. It does not call AcoustID's lookup service. No similarity score automatically changes the signature or digest verdict.

A separate **Review audio / video** page supports local playback, imported/pasted captions, optional self-hosted Whisper transcription, and optional timestamped frame sampling with English OCR. OCR is a limited aid: it can misread or miss text and does not replace a human visual review. The phrase scan remains limited and English-focused; it does not fetch sources, verify facts, or issue legal approval.

## Verification semantics

- **Signature valid** means the document's signed fields verify under the public key embedded in that document.
- **Exact file match** means the selected file has the same SHA-256 digest as the signed original.
- **Key pinned on this device** means the user chose to remember that key fingerprint in this browser. It is not a real-world identity certificate or external registry check.
- A signature or exact match does **not** establish that the publisher claim is true, that a named person is actually speaking or shown, that anyone consented, or that the media is factual.
- A digest mismatch can result from re-encoding or editing. It is not evidence of forgery and does not support watermark/SBR recovery.
- An optional Chromaprint score is only a candidate similarity hint between two fingerprints. It is not a signature, watermark, semantic comparison, publisher identity check, truth check, or calibrated pass/fail result. Chromaprint is designed for near-identical audio and is not a general-purpose fingerprint; validate it on the target voice clips, re-encodes, and unrelated negative samples before operational use.
- The fingerprint reference is signed into this RelayProof sidecar, but signing it only binds that value to the publisher's self-asserted key. The implementation caps fingerprint generation at 120 seconds. It uses local `pyacoustid` comparison and makes no AcoustID web lookup.
- For a video credential, exact SHA-256 binds the whole container file. A separate Chromaprint reference, if present, covers audio only—not visuals, edits, or frame provenance.
- No sidecar means **no conclusion** about authenticity. Absence of a record does not mean the media is fake.

The format is RelayProof's own versioned sidecar, not C2PA, a W3C Verifiable Credential, a blockchain transaction, or an independently reviewed standard.

## Local storage and key custody

- The non-extractable private signing key is kept in this browser's IndexedDB when supported; a small public archive and trusted-key pins use local browser storage.
- Clearing site data, changing browser/device, or losing access to this origin can make the issuer key unavailable. There is no key backup, account sync, recovery process, or production key-management service yet.
- Export each sidecar for distribution and backup. A sidecar includes public material only; it does not contain the private key.
- This browser prototype has not had an external security audit and should not be used to make high-stakes trust decisions.

## Current integration status

| Capability | Status |
|---|---|
| ECDSA P-256 signed media sidecar issuance (audio + video) | Implemented locally; legacy audio v1 sidecars still verify |
| Exact-byte SHA-256 verification (whole media file) | Implemented locally |
| Optional signed Chromaprint reference + local comparison | Integrated in UI/backend; requires native Chromaprint; candidate score only |
| Local key pinning | Implemented; user/device scope only |
| Audio/video playback + transcript phrase preflight | Implemented as a limited review aid |
| Timestamped sampled-frame OCR | Integrated; requires local Tesseract; samples do not replace human visual review |
| Automatic speech transcription | Optional self-hosted faster-whisper endpoint; install/run locally to enable |
| Factual source checking against authoritative data | Not integrated; manual evidence review only |
| Embedded C2PA manifest validation | Not integrated yet |
| OGG/Opus watermark or soft-binding recovery | Provider-neutral contract + explicit not-configured health state added; waiting for provider/API schema and test vectors; no recovery claim |
| Monad RPC, contract, or on-chain registry | Not connected; no contract details supplied |

## Optional Chromaprint candidate matching

The implementation uses [AcoustID/Chromaprint](https://github.com/acoustid/chromaprint) through [`pyacoustid`](https://pypi.org/project/pyacoustid/) 1.3.1 for local fingerprint generation and aligned fingerprint comparison. Fingerprints are signed into the sidecar when the publisher opts in; a recipient must click **Compare fingerprint** to compare a non-matching file. The comparison API is not used to look up a track or publisher online, and it needs no AcoustID API key. This does not replace the pending watermark/SBR API.

`pyacoustid` 1.3.1 requires Python 3.10 or newer. The Python dependency alone is not enough: install the native Chromaprint library (and an audio decoder). For example:

```bash
# Debian / Ubuntu
sudo apt update
sudo apt install libchromaprint-tools

# macOS with Homebrew
brew install chromaprint
```

On Windows, use WSL2 with the Debian/Ubuntu command above, or install a compatible native Chromaprint build that provides both the shared library and `fpcalc.exe`; configure `FPCALC` if `fpcalc` is not on `PATH`. `pyacoustid` still needs the native library for decoding fingerprints during local comparison. Then install `server/requirements.txt` and run the FastAPI service as shown below. `/api/health` reports whether the Chromaprint backend is ready. No remote AcoustID request is made.

No comparison threshold is configured or tested against your content. Do not convert any score to “same source,” “authentic,” or “fraud.” Benchmark genuine re-encodes and unrelated speech/music negatives before considering a decision threshold. Short clips, speech, noise, trimming, speed changes, and other edits can affect matching.

## Optional video-frame sampling and OCR

In the content-review page, **Sample frames + read on-screen text** seeks through the selected video in your browser and captures up to 24 evenly spaced stills (scaled to a maximum 1280-pixel edge). Only those JPEG stills and their timestamps are sent to the local `/api/ocr/frames` endpoint after you click; the full video is not sent for OCR. The backend uses local Tesseract with English data. The resulting timestamps can jump the player to the sampled moments, and the OCR text can be edited before it is included in the text pre-check.

This is **sampled English OCR**, not full-frame coverage, disclosure-duration analysis, subtitle/audio sync validation, or compliance approval. It may miss brief overlays and misread small/stylized/non-English text. A human still needs to inspect the whole clip. If you separately click **Transcribe media**, that action sends the full file to the configured transcription service.

The Python package is installed from `server/requirements.txt`, but the native OCR engine is separate:

```bash
# Debian / Ubuntu
sudo apt install tesseract-ocr

# macOS with Homebrew
brew install tesseract
```

On Windows, install a compatible Tesseract build and add its executable to `PATH`, or set `TESSERACT_CMD` to its path before starting the backend. `/api/health` reports the local OCR capability. The OCR service is not running in the shared preview.

## Optional automatic transcription (no API key)

An optional local FastAPI adapter uses `faster-whisper`; it is not running by default. To run the app and transcriber on your own machine:

```bash
# Terminal 1 — install and start the local transcription service
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
python3 -m uvicorn server.app:app --host 127.0.0.1 --port 8000

# Terminal 2 — start the web app; Vite proxies /api to the local service
npm ci
npm run dev
```

On Windows, use `py -m venv .venv`, activate the environment using your shell's virtual-environment command, and run `py -m pip install -r server/requirements.txt` followed by `py -m uvicorn server.app:app --host 127.0.0.1 --port 8000`. The default model is `base` on CPU with int8; it downloads its model weights the first time and may take a while. No transcription API key is needed. `WHISPER_MODEL=tiny` can be set for a smaller/faster test, or `small` for potentially better transcription at more cost. The backend binds to loopback when started with the command above and deletes its temporary media files after each media request.

When using a hosted/shared preview, any media explicitly sent to `/api/transcribe`, `/api/fingerprint`, or `/api/fingerprint/compare` is processed by that preview's backend. `/api/ocr/frames` receives the sampled still images, not the full video. Do not send confidential media to a shared preview; run both processes on your own computer for private clips. Upload temp files are removed after each request, but this prototype behavior is not a production retention/security guarantee.

Run the cryptographic unit tests and production build:

```bash
npm run test:credentials
npm run test:sebi
npm run test:sbr
npm run build
```

The crypto tests cover valid issuance, exact audio/video digest match, mismatching bytes, tampered claims, incorrect key fingerprints, and that an optional Chromaprint value is covered by the signature. The preflight tests cover limited phrase flags and ensure even a no-flag report is never treated as fact-checked or approved. Native Chromaprint matching, Tesseract OCR, and faster-whisper have not been runtime-tested in this environment because their local service/dependencies are not installed here.

## Automatic video/audio analysis limits

The optional self-hosted media adapter has three independent tasks: faster-whisper speech transcription, Chromaprint candidate matching, and Tesseract OCR on sampled stills. Each can fail or misread material. Whisper can mishear company names, ticker symbols, amounts, dates, and disclaimers; OCR can miss overlays. Users must correct transcripts and inspect the actual video. If you later prefer a hosted transcription provider, share public docs or a sanitized request/response example—never an API secret.

Even with transcription, factual checking needs dated primary sources (for example the relevant SEBI circular, exchange filing, issuer disclosure, or offer document) and human review. The current phrase scan does not fetch or validate source URLs.

## Chrome extension prototype

The unpacked Manifest V3 extension is in `extension/`. It can verify a sidecar and exact-hash a selected local audio/video file, or capture 15/30/60 seconds of the active tab's audio after the user clicks **Start tab capture**. For YouTube, start playback before clicking; the recording runs in an offscreen document, so the popup may be closed and reopened to see the result. The extension does not download the source media; a tab capture is a new recording and cannot be exact-hash authenticated.

To enable local fingerprint comparisons, load the extension unpacked from `extension/`, copy its 32-character ID from `chrome://extensions`, and set `RELAYPROOF_EXTENSION_ID` before starting the self-hosted backend. The backend then accepts browser requests only from that exact extension origin (plus any origins listed in `RELAYPROOF_ALLOWED_ORIGINS`) and only when the `Host` header is a loopback name. Requests with any other `Origin` or `Host` get HTTP 403 before a route runs; see `THREAT_MODEL.md` (T10–T12). Non-browser local processes are blocked only if you set `RELAYPROOF_API_TOKEN`. With the token set, every `/api/*` request must send `Authorization: Bearer <token>`, or the backend returns 401. Setup: generate the value with `python3 -c 'import secrets; print(secrets.token_urlsafe(32))'`, export it in the backend shell, and start `npm run dev` from the same environment. The Vite proxy adds the header server-side. The popup asks for the same value once and keeps it in `chrome.storage.local`. Do not put the token in a `VITE_` variable, because that ships to the browser. See `extension/README.md` for the full steps. The sidecar must contain a signed Chromaprint reference for tab matching; an arbitrary YouTube clip cannot be labeled AI/fake by this feature. Scores remain uncalibrated candidates only.

## Information needed for the watermark/SBR stage

A provider-neutral, fail-closed contract and test suite now live in `server/sbr_contract.py` and `server/test_sbr_contract.py`. Read [`SBR_API_INTEGRATION.md`](SBR_API_INTEGRATION.md) for the expected recovery semantics, data-safety requirements, and the exact non-secret API details needed before a real provider can be wired in. The provider is not configured; `/api/sbr/health` reports that explicitly.

Please share the API's **non-secret** integration details:

- documentation URL or a sanitized example request/response;
- endpoint and HTTP method(s);
- supported input types and size limits, especially OGG/Opus voice notes;
- whether it embeds watermarks, resolves an existing watermark, or both;
- response fields and match/confidence/false-positive semantics;
- authentication method and whether credentials must remain server-side;
- whether files are uploaded, retained, or logged, and for how long.

Do not paste API keys, bearer tokens, passwords, private keys, or other secrets into chat. If the API needs a secret, we should route it through a small server-side adapter and put the value in a local `.env` file or deployment secret store—not a `VITE_` client variable.
