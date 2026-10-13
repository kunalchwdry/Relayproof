# RelayProof brief review: fact check and changes (13 Oct 2026)

This file checks each claim in the "RelayProof Brief Review" (@Saif, 13 Oct 2026) against the workspace and, where needed, against public sources. Verdicts:

- **True**: supported by the code, docs, or a public source.
- **Partly true**: the core point holds but a detail is overstated or missing.
- **False / outdated**: contradicted by the current code or docs.
- **Unverified**: no evidence either way in the workspace or sources checked.
- **Opinion**: a judgement, not a checkable fact.

## A. Overview paragraph

| Claim | Verdict | Evidence |
|---|---|---|
| Signed-sidecar prototype using ECDSA P-256 and exact-file SHA-256 | True | `src/credential.js` (`ECDSA-P256-SHA256`, `sha256Hex`); `RELAYPROOF_DETAILED_OVERVIEW.md` §1 |
| Optional Chromaprint, Whisper and OCR aids | True | `server/app.py` routes `/api/fingerprint`, `/api/transcribe`, `/api/ocr/frames` |
| Chrome extension, Track 04 framing | True | `extension/manifest.json` (MV3); overview §2 |

## B. Errors and design flaws

| # | Claim | Verdict | Evidence / note |
|---|---|---|---|
| 1 | Forwarded voice notes strip the sidecar and re-encode (WhatsApp uses Opus), so the exact-hash check fails "in nearly every real forward" | **Partly true, overstated** | The sidecar is a separate file, so it is lost on forward: true by design. Exact hash breaks on re-encode: true. WhatsApp's business docs require OGG/Opus for voice messages (cited in `idea.md`). The brief says explicitly that the source "does not establish that every app upload or forward re-encodes in the same way." No source in the workspace supports "nearly every". Re-encoding resilience as the core requirement is consistent with overview §3 and Phase 2. |
| 2 | A self-asserted key proves little; anyone can re-sign | **True** | Keys are generated per browser (`generateSigningKeyPair`); the verifier trusts the `publicKeyJwk` embedded in the sidecar. The overview and the sidecar `limitations` array say so. |
| 3 | Non-extractable IndexedDB key; clearing data destroys the identity; no rotation or revocation | **True** | `generateSigningKeyPair` uses `extractable=false`; `src/storage.js` writes the key to IndexedDB; `LIVE_VERIFIER.md` "Local storage and key custody". No rotation or revocation code exists. |
| 4 | "No timestamp" | **False as stated** | `issuedAt` is in the signed payload (`src/credential.js`). The correct point is that it is self-asserted, with no external timestamp, so it can be backdated. The limitations array already says this. Corrected in `THREAT_MODEL.md` T7. |
| 5a | Chromaprint, Whisper and Tesseract need a Python server every recipient must run | **Partly true** | Only those optional features need the server. Signature and SHA-256 checks run entirely in the browser (`LIVE_VERIFIER.md`). |
| 5b | CORS restricted to an extension ID is not a security control; non-browser clients ignore it; DNS rebinding can still reach it | **True** | CORS middleware is added only when `RELAYPROOF_EXTENSION_ID` is set. Before this change, a request with `Host: attacker.example` returned 200, and a cross-site `Origin` POST was processed (tests failed 5/9). |
| 5c | Needs a bearer token, a 127.0.0.1 bind, and an Origin/Host check | **Implemented, except binding** | Origin and Host checks: `local_request_guard` in `server/app.py`. Bearer token: optional `RELAYPROOF_API_TOKEN`, sent by the popup and the Vite proxy. Loopback bind: documented in `LIVE_VERIFIER.md`; not enforced in code (uvicorn's `--host` controls it). |
| 6a | Popup-based tab capture breaks when the popup loses focus | **True (fixed)** | The original `popup.js` called `chrome.tabCapture.capture` from the popup and said "keep this popup open". Now recording runs in the service worker and offscreen document. |
| 6b | The supported MV3 approach is `getMediaStreamId` plus an offscreen document | **True (implemented, not Chrome-tested)** | Chrome's docs: from Chrome 116, `tabCapture.getMediaStreamId` in a service worker, then an offscreen document with `USER_MEDIA` (developer.chrome.com screen-capture guide; mv3-extension.com). Implemented in `background.js` and `offscreen.js`. |
| 6c | Tab capture mutes the tab unless audio is routed back out | **True, handled** | The original `popup.js` connected the stream to `audioContext.destination`. The new `offscreen.js` does the same. Still needs a Chrome run. |
| 6d | DRM-protected media may capture as silence | **Unverified** | Not checked in the workspace or sources. |
| 6e | Extension untested in Chrome | **True** | `RELAYPROOF_DETAILED_OVERVIEW.md` §8. |
| 7a | Chromaprint is built for music identification and fits short voice notes poorly; no calibrated threshold | **True** | Overview §5.4 and §13; the sidecar `limitations` text; `LIVE_VERIFIER.md`. |
| 7b | pyacoustid "comparison utilities" need verification | **True (verified)** | `pyacoustid` 1.3.1 defines `compare_fingerprints(a, b)` in `acoustid.py`. The app calls it in `_compare_fingerprint`. |
| 8a | No JSON canonicalization (RFC 8785) | **True** | Custom `canonicalize()` named `relayproof-canonical-json-v1`; it is not JCS. Documented in `THREAT_MODEL.md` §3. |
| 8b | WebCrypto emits raw r‖s, not DER | **True** | `crypto.subtle.sign` for ECDSA returns the IEEE P1363 `r‖s` form. The code does not convert it. Documented in `THREAT_MODEL.md` §3. |
| 8c | Sidecar needs explicit version and algorithm fields | **Partly false / outdated** | `schema` carries the version (`relayproof.media-credential.v1`); `proof.algorithm` and `proof.canonicalization` are present. There is no separate top-level version field. |
| 8d | No threat model | **True before this change** | Added as `THREAT_MODEL.md`. |
| 9 | SEBI phrase rules, Whisper and OCR are scope creep and carry legal-perception risk | **True (facts); opinion on risk** | They are in the code (`src/sebiPreflight.js`, `server/app.py`). Their risk is a judgement. The docs already disclaim them. |
| 10a | The hackathon window ends 13 Oct 2026 | **True** | The Metropolis page says "1 Sep to 13 Oct · Online global hackathon". Today is 13 Oct 2026, so **the window ends today**. The page does not give a time or timezone; check `hackathon.monad.xyz`. |
| 10b | A Monad entry with no Monad component is a weak fit | **True (fact); opinion on fit** | No contract, RPC, or wallet is connected (`LIVE_VERIFIER.md` status table). |

## C. Better solutions

| Claim | Verdict | Evidence / note |
|---|---|---|
| C2PA covers audio and video, supports embedded manifests, and defines soft bindings and an SBR API | **Partly true** | `idea.md` §3 says C2PA 2.4 includes audio as a decoded media type for soft bindings. It also says the CAI `c2patool` lists M4A, MP3, and WAV, **not OGG**. The review omits this, and it matters for Opus voice notes. |
| c2pa-js / WASM exists for the browser | **True, with a name change** | The browser package is now `c2pa-web` in the `contentauth/c2pa-js` monorepo, backed by `c2pa-wasm` ([GitHub](https://github.com/contentauth/c2pa-js)). |
| AudioSeal is a reusable open watermark with a 16-bit payload | **True** | `idea.md` §3 describes the 16-bit message. |
| AudioSeal licence needs checking | **Resolved** | MIT, including the model weights ([GitHub](https://github.com/facebookresearch/audioseal)). |
| Monad registry adds value as a shared issuer and revocation ledger | **Opinion; contested in the workspace** | `RELAYPROOF_DETAILED_OVERVIEW.md` §10 Phase 4 says Monad should be added only if justified, and `idea.md` §2 says a single-publisher product could use a normal signed database. |
| Watermark + registry is the design to build | **Overlap not mentioned in the review** | `idea.md` §4 lists AWS SENTINEL (AudioSeal + C2PA + registry, audio) and Grain (Track 04 onchain C2PA with a soft-binding resolver, image) as close prior art. The proposed design is not novel. |
| The user's watermark/SBR API is an unverifiable dependency | **True** | No API docs, schema, or test vectors exist in the workspace. `SBR_API_INTEGRATION.md` requests them. |
| Tesseract.js and WASM Whisper could move processing into the browser | **Unverified (design option)** | Not checked. |

## D. Cross-document inconsistency

- `idea.md` (research brief) recommends an audio watermark plus a Monad registry. Its five-day plan includes a PublisherRegistry and a CredentialAnchor.
- `RELAYPROOF_DETAILED_OVERVIEW.md` (dated the same day) says the watermark is **not built**, Monad is **not connected**, and Monad should be added only if justified.

The review's redesign follows `idea.md`. The docs and code follow the overview. The team should pick one direction.

## E. Changes made

1. **Local-request guard** (`server/app.py`): rejects requests whose Host is not loopback (or in `RELAYPROOF_ALLOWED_HOSTS`), and whose Origin is not the configured extension or in `RELAYPROOF_ALLOWED_ORIGINS`. Closes DNS rebinding and cross-site simple-POST access.
2. **Optional bearer token** (`server/app.py`): when `RELAYPROOF_API_TOKEN` is set, every `/api/*` request (except CORS preflight) needs `Authorization: Bearer <token>`. Compared in constant time.
3. **Vite proxy** (`vite.config.js`): `changeOrigin: true`, strips `Origin`, and adds the token from the server-side environment (never a `VITE_` variable).
4. **Tab capture rewritten** (user-selected next step): `extension/background.js` (service worker: `getMediaStreamId`, offscreen lifecycle, state in `chrome.storage.session`), `extension/offscreen.js` (records, routes audio back to the speakers, posts the clip to the local compare endpoint with the token), `extension/offscreen.html`. The popup now only starts and stops capture and renders stored state, so recording survives the popup closing. `manifest.json` adds `offscreen` and `storage`, and a service-worker `background`.
5. **Popup token field** (`extension/popup.html`, `popup.js`): stores the token in `chrome.storage.local` and sends it with every call.
6. **Tests**:
   - `server/test_local_guard.py`: 14 tests (guard and token).
   - `test/extension-capture.test.mjs`: 8 tests for the capture pipeline, with a stubbed `chrome` API.
   - `test/extension-credential-sync.test.mjs`: 5 tests. The extension keeps its own copy of `credential.js`; these tests check that it agrees with `src/credential.js`.
7. **Tests are not proof of Chrome behaviour.** The stubs check our logic only. Chrome itself has not been run.
8. **Docs**: `THREAT_MODEL.md` (new), `LIVE_VERIFIER.md`, `extension/README.md`, `RELAYPROOF_DETAILED_OVERVIEW.md`. CORS-only wording is replaced.
9. **`package.json`**: `test:server` and `test:extension` scripts.

## F. Not changed (needs a decision)

- SBR recovery and C2PA migration. These are still product decisions (see section D).
- Monad registry and watermark: **prototype built on the free track, not yet deployed to testnet.** The AudioSeal spike and the issue/verify CLI are in `wm/` (see `wm/README.md`). The registry contract passes 7/7 Hardhat tests and has been run on a local chain. Deployed to Monad testnet (chain 10143) at `0x833975Bd88b28B25551dc06F0A87B723dd350c00`. A demo registration and a verify round-trip are recorded in `wm/README.md` and `wm/demo-testnet/`. The shared direction is still open (section D).
- Canonicalization migration to RFC 8785 and DER signatures. Both need a v2 sidecar format.
- Removing Chromaprint, SEBI, Whisper, or OCR (product scope).
- Token setup is documented in `extension/README.md` and `LIVE_VERIFIER.md`. Live check done on a running uvicorn: no Bearer 401 (with `WWW-Authenticate: Bearer`), wrong Bearer 401, correct Bearer 200, bad Host 403, cross-site Origin 403, allowed extension Origin preflight 200.
- Real-Chrome runtime test of the new capture path, including whether a popup click grants `activeTab` for `getMediaStreamId`.

## G. Test results after changes

- `npm run test:server`: 21/21 (14 guard and token, 7 SBR contract)
- `npm run test:extension`: 13/13 (8 capture pipeline, 5 credential sync)
- `npm run test:credentials`: 7/7
- `npm run test:sebi`: 3/3
- `npm run build`: passes
- `scripts/test_competitor_watch.py`: runs from `scripts/` (the earlier failure was a runner path issue, not a code fault)

## H. Additional findings (not in the review)

- **Duplicated verifier.** `extension/credential.js` is a hand-maintained copy of `src/credential.js`. Its verification logic matches, but the two can drift. `test/extension-credential-sync.test.mjs` now checks that a sidecar signed by the app verifies in the extension, and that tampered sidecars fail in both.
- **Vite proxy `changeOrigin: false`** would have sent the preview's own Host to the backend, so the new Host guard would have blocked the app's API calls. Fixed in `vite.config.js`.
- **Competitor-watch test** (`scripts/test_competitor_watch.py`) fails if run from the project root, because it imports `competitor_watch` by bare name. It passes from `scripts/`. Pre-existing; not changed.
- **Two documents disagree on direction** (section D). This is the largest open question.
- **Submission window.** The Metropolis page says "1 Sep to 13 Oct". Today is 13 Oct, so the window closes today. The exact time and timezone are not published on that page.
