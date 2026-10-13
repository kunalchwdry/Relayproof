# RelayProof threat model (prototype, 13 Oct 2026)

Scope: the browser-side sidecar (`relayproof.media-credential.v1`), the exact-file SHA-256 check, the optional self-hosted media API (`server/app.py`), and the Chrome extension (`extension/`). Monad, watermark/SBR recovery, and C2PA are **not** implemented, so they are not part of this model.

Status key: **Mitigated** = a control exists in code and has a test or runtime check. **Partial** = some control exists but a meaningful gap remains. **Open** = no control exists.

## 1. Assets and actors

| Asset | Protects |
|---|---|
| Publisher private key (non-extractable ECDSA P-256 in IndexedDB) | The ability to sign new sidecars as this publisher |
| Sidecar contents (issuer name, asset title, claim, digest, issuedAt) | What the publisher said about the file |
| Recipient's local media | Privacy of files sent to the optional local API |

Actors considered: (a) a recipient who forwards or edits media; (b) an attacker who copies a sidecar and changes it; (c) an attacker who creates their own key and signs a false claim; (d) a hostile web page open in the same browser; (e) a hostile site using DNS rebinding; (f) a local process on the same machine; (g) someone with script access to the publisher's origin.

## 2. Threats and current status

| # | Threat | Status | Control today | Residual risk / next step |
|---|---|---|---|---|
| T1 | **Stripping**: a messaging or forwarding app drops the `.relayproof.json` sidecar | Open | None. The sidecar is a separate file. | Known design limit. Needs an embedded or soft-bound identifier (watermark or C2PA). Not built. |
| T2 | **Re-encoding**: the file is transcoded, so the exact hash no longer matches | Open (by design) | Exact-hash check reports "no exact match" and does not call it fake. Chromaprint is an uncalibrated candidate hint only. | No re-encoding-resilient recovery exists. The SBR adapter fails closed (`not_configured`). |
| T3 | **Tampering** with signed fields (claim, title, issuer name, digest) | Mitigated | ECDSA P-256 signature over the canonicalized payload; any field change fails verification (covered by `test/credential.test.mjs`). | None for tampering. |
| T4 | **Re-signing**: an attacker generates a key and signs a false claim with a valid signature | Open | The key is self-asserted and the UI labels it so. Local key pinning is user/device scope only. | Needs an identity layer: domain-bound keys (`/.well-known/`), passkeys, or an issuer registry. Not built. |
| T5 | **Key theft** from the publisher's browser profile | Partial | The key is non-extractable, so page script cannot export the raw key. Same-origin script can still *use* the key to sign. | Keep the origin clean; add hardware-backed or passkey keys later. |
| T6 | **Key loss**: clearing site data or changing device | Open | None. No backup, export, or recovery flow. | Users must export sidecars; the key itself cannot be recovered. Rotation and revocation are not implemented. |
| T7 | **Backdating**: `issuedAt` is set by the publisher's clock | Open | `issuedAt` is signed but self-asserted. The limitations array says it is not an external timestamp. | Needs an RFC 3161 TSA or an anchored digest (Monad) for "existed at time T". |
| T8 | **Replay / stale credential**: an old valid sidecar is presented after the publisher has moved on | Open | None. There is no revocation or supersession. | Needs a status source (registry or signed status list). |
| T9 | **Sidecar moved to a different file**: a valid sidecar is shown with unrelated media | Mitigated for exact match | The digest check reports a mismatch and the signature result stays separate. | A mismatch is not proof of fraud (the file may be a legitimate re-encode). |
| T10 | **Cross-site request** to the local API: a hostile page POSTs media to `127.0.0.1:8000` | Mitigated | `local_request_guard` in `server/app.py` rejects any request whose `Origin` is not the configured extension or allowed origin. Tests: `server/test_local_guard.py`. | CORS alone did not stop this: simple multipart POSTs reach the server. |
| T11 | **DNS rebinding**: a hostname that resolves to loopback reaches the local API | Mitigated | Host header must be `localhost`, `127.0.0.1`, or `[::1]` (or listed in `RELAYPROOF_ALLOWED_HOSTS`). Tested. | Bind to loopback (documented). Vite dev proxy sets `changeOrigin: true` so the Host check passes. |
| T12 | **Other local processes** call the API without a browser | Partial | Optional bearer token: set `RELAYPROOF_API_TOKEN` on the backend; every `/api/*` request must send `Authorization: Bearer <token>`. The Vite proxy adds it server-side; the extension stores it in `chrome.storage.local` (tests: `server/test_local_guard.py`). Without the variable set, only Host/Origin rules apply. | The token is a shared secret in browser storage, so anyone with the extension profile can read it. It is not per-user auth. |
| T13 | **Media leaves the machine** when a user uses a shared preview backend | Partial | Docs warn not to use the shared preview for private media. Temp files are deleted per request. | No retention guarantee. Use a self-hosted backend for private clips. |
| T14 | **Misleading score**: a Chromaprint similarity is read as a verdict | Partial | Scores are labelled uncalibrated and not a verdict; no pass threshold is configured. | Benchmark on real voice notes before any decision threshold. |
| T15 | **Tab-capture misuse**: the extension records the active tab | Partial | Only after a user click on Start. Capture uses `getMediaStreamId` in the service worker and an offscreen recorder (the MV3 pattern). Captured audio is held in memory and not saved. Stop and timeout paths are tested with a stubbed `chrome` API. | Not yet run in Chrome. Whether a popup click grants `activeTab` for `getMediaStreamId` is an assumption to check in a real browser. DRM-protected media may capture as silence. |

## 3. Format and interoperability limits (not security controls)

These are facts about the current sidecar that a second implementation must match.

- **Canonicalization is custom.** The scheme is named `relayproof-canonical-json-v1`. It sorts object keys, drops `undefined` values, and uses `JSON.stringify` for scalars. It is **not RFC 8785 (JCS)**. A non-JavaScript verifier must reimplement this exact scheme. Migrating to JCS would need a new canonicalization identifier (v2).
- **Signature encoding is raw P1363.** WebCrypto emits a 64-byte `r || s` signature, not DER. OpenSSL-style and most X.509 libraries expect DER, so they need a conversion step.
- **Versioning is in the schema string and the proof block.** There is no separate top-level version field. The version is `relayproof.media-credential.v1` (in `schema`). The algorithm is `proof.algorithm = ECDSA-P256-SHA256`, and `proof.canonicalization` names the scheme.
- **Hash scope.** `asset.sha256` is the SHA-256 of the whole file bytes. For video, the hash covers the container, not just the audio.
- **Chromaprint reference (optional).** When present, it is covered by the signature. The signature binds the value to the publisher's key; it does not make the fingerprint trustworthy.

## 4. What this model does not cover

- Monad registry, contract, or revocation (not built).
- Watermark, SBR, or C2PA recovery (adapter contract only; no provider configured).
- Browser-extension runtime behaviour (not loaded in Chrome yet).
- A formal security audit. This is a prototype.
