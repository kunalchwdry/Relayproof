# RelayProof — Detailed Project Brief

**Version:** 1.0  
**Prepared:** 13 October 2026  
**Project type:** Audio/video media-provenance prototype  
**Hackathon context:** Monad Metropolis, Track 04 — Trust, Identity & AI Infrastructure  
**Status:** Prototype / problem-fit concept. This document does **not** claim official Monad endorsement, hackathon entrant status, or a Monad deployment.

> **One-line summary:** RelayProof issues a locally signed source claim for an audio or video file, checks the signature and exact file bytes, and gives reviewers optional local tools for candidate audio matching, transcript preflight, and sampled-frame OCR—with explicit limits on what each result proves.

---

## 1. Executive summary

Media is routinely copied, trimmed, transcoded, and forwarded without its original context. A cryptographic signature can show that a signed claim has not been changed, and a SHA-256 digest can show whether a selected file has the same bytes as the signed original. Those checks are useful—but they do not establish that the publisher is who they say they are, that a claim is true, or that a re-encoded copy came from the original.

RelayProof is a prototype for making those distinctions visible. Its current core is an ECDSA P-256 signed JSON sidecar plus an exact-file SHA-256 check. Optional tools provide a Chromaprint audio-similarity candidate score, transcript/content preflight, and OCR over selected video frames. A Chrome extension adds local-file checking and an explicit current-tab audio-capture path.

The key limitation is also the key product question: the official Metropolis Track 04 prompt includes **generated-media provenance that survives re-encoding**. RelayProof does **not** currently provide that capability. Its exact hash changes when the file is transformed; Chromaprint is an uncalibrated candidate-matching aid, not soft-binding recovery or provenance verification. A provider-neutral SBR adapter contract and explicit not-configured health state have now been added, but the user's actual watermark/SBR API is still not wired in; Monad anchoring is not connected.

---

## 2. Monad Metropolis context and official problem statements

The official Metropolis page lists four tracks:

1. **Onchain Finance & Trading** — fully onchain financial instruments and markets.
2. **Consumer Products & Payments** — user-facing products using onchain rails.
3. **Social, Attention & Culture** — social graphs, programmable incentives, and cultural markets.
4. **Trust, Identity & AI Infrastructure** — infrastructure for identity, provenance, data ownership, and agent trust.

The official Track 04 introduction says:

> “AI has made identity, provenance, data ownership, and agent trust urgent infrastructure problems.”

The page gives three **example directions** under Track 04—not a cumulative checklist that every project must implement:

- Passkey-native accounts using P-256 and WebAuthn, with no seed phrase.
- Agent identity and reputation under ERC-8004.
- Provenance for generated media that survives re-encoding.

**Selected RelayProof scope:** focus on the third direction, media provenance after re-encoding. Passkey accounts and ERC-8004 agent identity/reputation are separate example directions and are out of scope for this build.

### RelayProof’s fit

RelayProof is **directionally related** to the third example: media provenance. The fit is not a claim of completion. The current prototype binds a claim to exact bytes and does not recover a provenance record after re-encoding. It also does not implement a WebAuthn/passkey account, ERC-8004 agent identity, a shared issuer registry, or a Monad smart contract.

The event page lists a 1 September–13 October 2026 window. Refer to the official hackathon portal for current submission status and rules; this project document does not imply that RelayProof was registered or submitted.

---

## 3. Problem statement

### User problem

A recipient who gets a forwarded voice note or video may not know:

- whether the selected bytes are exactly the file that a publisher signed;
- whether the signed key belongs to the real-world publisher named in the claim;
- whether a transformed copy can be linked back to the original;
- whether spoken or displayed statements are factual, contextually complete, or compliant with relevant rules.

These are different questions. A single green “authentic” badge would collapse them and overstate the evidence.

### Product question

**How might a publisher attach a portable source claim to audio/video, and help a recipient inspect what is cryptographically supported, what is only a candidate match, and what still needs human review?**

### Track 04 gap to solve

The official prompt’s re-encoding-resilience example is stronger than exact-file matching. A SHA-256 digest is expected to change when media is re-encoded. A future implementation needs a genuine watermark/soft-binding/C2PA recovery path, with measured results across transformations—not just a hash, a registry, or a high similarity score.

---

## 4. Intended users and initial workflow

Potential user groups for discovery—not validated market segments—include:

- publishers and media desks issuing an origin declaration with an audio/video file;
- recipients and reviewers checking whether a file matches the signed original;
- compliance or editorial reviewers who need to inspect transcripts, captions, claims, or overlays;
- teams evaluating local-first media tooling and its privacy boundaries.

A narrow prototype workflow is:

1. A publisher selects an audio/video file and declares its source context.
2. RelayProof hashes the exact file bytes and signs a JSON sidecar with a locally held key.
3. The publisher shares the sidecar with the original file.
4. A recipient checks the sidecar signature and exact-file digest.
5. If the bytes differ, a fingerprint comparison may surface a candidate audio match—if an appropriate signed reference exists and the optional local service is running.
6. A human can review a transcript, limited phrase preflight, and sampled OCR text separately from provenance.

---

## 5. Feature-by-feature description

### 5.1 Issue a signed media sidecar

- Supports audio or video selection up to **128 MB**.
- Creates a publisher/source claim and binds it to the whole-file **SHA-256** digest.
- Signs the sidecar with **ECDSA P-256** using a locally held browser key.
- Exports a signed JSON sidecar for sharing alongside the selected media.
- The issuer name and public key are self-asserted in the prototype; they are not independently certified.
- Existing RelayProof audio sidecars remain supported alongside the newer audio/video sidecar format.
- Optional Chromaprint issuance fingerprints up to the first **120 seconds** of audio. For video, it covers the audio track only—not the picture. This optional path sends the selected media to the publisher’s self-hosted local service.

### 5.2 Verify signature and exact bytes

The verifier reports separate checks:

- **Signature:** whether the signed fields validate against the public key embedded in the sidecar.
- **Exact-file digest:** whether the selected media’s SHA-256 matches the digest in the signed sidecar.
- **Key pin:** an optional local reminder on the current device; not an identity certificate or shared trust registry.

A matching digest means the selected bytes match the signed bytes. A mismatch can be caused by ordinary transcoding, trimming, or editing; it is **not proof of fraud**. A valid signature means only that the signed data checks against the included public key.

### 5.3 Local archive

Issued records can be reopened or exported from the browser-local archive. Credential records and trust pins are stored in browser local storage; the private signing key is stored in IndexedDB as a non-extractable browser CryptoKey. The prototype has no key export or recovery flow. Browser storage is not a backup: export sidecars separately, and assume that clearing browser data can remove the archive and signing key.

### 5.4 Chromaprint candidate matching

- Optional local fingerprint generation and comparison use Chromaprint through a self-hosted media service.
- It is intended for near-identical audio identification/candidate matching—not general trust, identity, or truth verification.
- The returned similarity score is not calibrated to a reliable pass/fail threshold for voice-note provenance.
- No AcoustID web lookup is made by the prototype.
- A high score is not proof of common publisher, authentic origin, a true claim, or whether audio was AI-generated.
- For video, only its audio track is compared; visual frames are not compared.

### 5.5 Transcript and content preflight

The content-review interface can play selected local media, accept pasted text, and import subtitle/caption files. An optional self-hosted **faster-whisper** route can transcribe media; there is no hosted speech-transcription API configured for this project.

The current preflight uses six limited English phrase-rule groups: return/accuracy promises, possible SEBI endorsement claims, security-specific recommendations, numeric/performance claims, public-issue terms, and paid-promotion language. It can surface some numeric/date/security references for a person to check against primary sources. It does not:

- fetch official records or verify facts;
- establish a speaker’s identity or registration status;
- determine whether a clip is complete or taken out of context;
- provide legal advice or a “SEBI approved” / “good to go” result.

SEBI review needs to be sensitive to speaker role, content type, publication date, context, and changing rules. Human review and current primary sources remain necessary.

### 5.6 Video OCR

- The browser can sample up to **24 evenly spaced frames** from a selected video.
- After the user clicks scan, only those selected still images—not the full video—are sent to the local Tesseract service.
- Returned English OCR text is associated with timestamps; a reviewer can jump to a sampled point, edit text, and include it in the phrase scan.
- Sparse samples can miss short overlays. OCR can misread small, stylized, low-contrast, or non-English text and does not assess disclosure duration or every frame.

### 5.7 Chrome extension

The extension is an unpacked **Manifest V3** prototype with two workflows.

**Local file:** select a media file and sidecar. The extension verifies the sidecar signature and, for files up to 128 MB, computes the exact hash locally. If the bytes differ and the signed sidecar has a Chromaprint reference, it can request an optional candidate comparison from the user’s local backend.

**Current-tab audio:** start playback, open the popup, load a sidecar containing a Chromaprint reference, and click **Start Tab Capture**. Choose 15, 30, or 60 seconds. Recording runs in a background worker and offscreen document, so closing the popup does not stop it. This records audio currently playing in the tab; it does not download the source video or access its original bytes. The capture is a new recording, so it cannot exact-hash-match the source file.

The tab workflow is user-initiated and requires an active audio track, a usable sidecar reference, and a running local Chromaprint service. The backend accepts browser requests only from the configured extension ID and only with a loopback `Host` header (see `THREAT_MODEL.md`). The extension has passed syntax/manifest checks but has **not yet been loaded and runtime-tested in Chrome**.

---

## 6. Architecture and privacy boundaries

### Processing locations

| Operation | Where it runs | What leaves the browser |
|---|---|---|
| Sidecar signature check | Browser / extension | Nothing |
| Exact SHA-256 file hash | Browser / extension | Nothing |
| Chromaprint generation/comparison | Self-hosted local API, after the relevant action | Selected media sent to the user’s local API |
| Whisper transcription | Optional self-hosted local API, after the user requests it | Full selected clip sent to the user’s local API |
| Video OCR | Browser sampling + self-hosted local Tesseract service | Selected sampled stills, not the full video |
| AcoustID or cloud lookup | Not configured | No remote lookup is made by this prototype |

“Local” means the user’s own machine or environment where they have started the API. It does not mean the shared development preview has a working or private backend. The last backend health request returned `ECONNREFUSED` on localhost; it was not running in the preview environment.

Optional runtime dependencies include native Chromaprint/fpcalc for fingerprinting, Tesseract for OCR, and faster-whisper plus a local model for transcription. These optional services have not been runtime-validated in the current project environment.

---

## 7. Evidence semantics: what each result can and cannot establish

| Signal | It can support | It cannot establish |
|---|---|---|
| Valid sidecar signature | The signed fields verify against the public key embedded in the sidecar | Real-world identity, publisher authorization, claim truth, consent, or regulatory approval |
| Exact SHA-256 match | The selected bytes match the digest that was signed | Who created the file, whether the content is true, or whether a non-matching derivative is fake |
| Local key pin | A key matches a reminder stored on this device | A global identity or a trusted certificate chain |
| Chromaprint score | A possible near-identical audio candidate worth inspecting | Provenance, signer identity, AI-generation status, or a reliable pass/fail verdict |
| Transcript / phrase flags | Text that may deserve human review | Fact-checking, complete context, speaker identity, or SEBI clearance |
| Sampled-frame OCR | Text recognized in selected sampled images | Full-video coverage, accurate reading of every overlay, or disclosure compliance |
| Future Monad digest anchor (not built) | Potentially, an auditable on-chain record of a digest/status event | Media truth, identity without an identity design, or post-transcode recovery by itself |

---

## 8. Current implementation and validation status

### Checks that passed

- JavaScript syntax checks for the extension files.
- MV3 manifest JSON validation.
- Python syntax compilation for the local API.
- **7/7** credential tests.
- **3/3** content-preflight tests.
- Production front-end build (`npm run build`, 13 Oct 2026).
- **7/7** provider-neutral SBR contract tests for fail-closed readiness, result normalization, safe filenames, and non-verdict statuses.

The SBR tests validate the adapter boundary only; they do **not** exercise the user's provider API.

### SBR integration status

A provider-neutral result contract and validators are in `server/sbr_contract.py`. `/api/health` and `/api/sbr/health` now report SBR as `not_configured`. There are **no media upload, watermark-issue, or recovery routes enabled**, and no vendor API call is made. This deliberately fails closed until the API schema, auth method, data-retention rules, and test vectors are supplied. See [`SBR_API_INTEGRATION.md`](SBR_API_INTEGRATION.md).

### Not yet runtime-validated

- Loading and exercising the extension in Chrome.
- The optional local backend and end-to-end browser-to-backend flows.
- Native Chromaprint comparison and any score calibration.
- Tesseract OCR quality on representative frames.
- faster-whisper transcription quality on representative speech.
- Any real watermark/SBR recovery API integration.
- Any Monad contract, transaction, registry, or revocation flow.

These are prototype engineering checks, not user adoption, security audit, robustness, compliance, or hackathon judging results.

---

## 9. Positioning and competitive caution

The general space of media provenance, watermarks, C2PA credentials, manifest recovery, browser verification, and on-chain provenance is active. Adjacent products and projects already exist, including watermark-plus-certificate tools, C2PA/SBR work, browser-side validators, and Metropolis projects describing image provenance on Monad.

RelayProof should **not** claim that it is category-first, that audio provenance is uncontested, or that a partial public-repository scan establishes the full competitor landscape. Current differentiation is only a **hypothesis**: a careful recipient workflow for audio/video sidecars that keeps exact integrity, candidate similarity, and human content review distinct, including an explicit browser-extension capture path. That hypothesis needs user research and comparative testing.

See [`COMPETITOR_COMPARISON.md`](COMPETITOR_COMPARISON.md) for the current bounded comparison and caveats. Repository descriptions and vendor claims should not be treated as independent feature validation or proof of official hackathon entrant status.

---

## 10. Roadmap to a testable Track 04 proposition

### Phase 1 — Runtime and privacy validation

- Load the extension unpacked in Chrome and test local-file verification end to end.
- Exercise current-tab audio capture with permission prompts and multiple sites.
- Start the backend locally; validate the Origin and Host guard for the extension ID (`server/test_local_guard.py` covers the rules; runtime check still needed).
- Test the optional Chromaprint, faster-whisper, and Tesseract paths with documented, reproducible fixtures.

### Phase 2 — Actual post-transcode recovery

- Obtain sanitized documentation, a request/response schema, and non-sensitive test vectors for the watermark/SBR API the user reports having.
- Integrate a genuine watermark or soft-binding recovery path rather than treating Chromaprint as provenance.
- Measure recovery and false matches across Opus/AAC re-encodes, bitrates, trims, noise, speed changes, overlays, and edits. Publish misses and failure cases as well as successes.
- Test short speech clips separately from music; do not infer speech robustness from music-only results.

### Phase 3 — Identity and governance

- Decide how issuer keys are created, backed up, rotated, associated with real entities, and revoked.
- Define consent and disclosure handling, including what information is public and what stays private.
- Keep publisher claims clearly labeled as self-asserted until an external identity model exists.

### Phase 4 — Monad only if it adds demonstrated value

- First specify what a shared public ledger solves for multiple independent issuers.
- If justified, consider anchoring minimal credential digests, issuer/key references, and status/supersession events on Monad.
- Keep raw audio/video, private editorial data, and sensitive personal information off-chain.
- Demonstrate a real testnet transaction and an independently verifiable lookup before claiming integration.

---

## 11. Demo plan and success criteria

### Suggested demo sequence

1. Issue a signed sidecar for a known test clip.
2. Verify the original file and explain signature validity separately from exact-byte match.
3. Transcode a copy and show the digest mismatch; do not call it fake.
4. If configured, show a candidate Chromaprint score as an experimental hint, not a verdict.
5. Review an imported transcript or subtitle, run the limited text preflight, and manually verify sources.
6. Sample video frames and demonstrate timestamped OCR on the selected stills.
7. Show the extension’s local-file workflow and, after Chrome runtime setup, current-tab audio capture.
8. Close with the non-connected capabilities: re-encoding recovery, external identity/revocation, and Monad anchoring.

### Metrics to gather before making performance claims

- Post-transcode recovery and false-match rate by codec, bitrate, trim, noise, and clip duration.
- Candidate-score distributions for known matches and non-matches; threshold calibration on representative voice notes.
- OCR word error and missed-overlay rate by frame selection, display size, contrast, and language.
- Transcription errors for names, tickers, amounts, dates, and disclaimers.
- Content-preflight false-positive and false-negative examples reviewed by qualified humans.
- Extension capture success rate, permission failures, and confirmation that media is sent only to the intended local service.

No such robustness or calibration claims are made by the current prototype.

---

## 12. Seven-slide deck map

The companion PowerPoint is [`presentation/relayproof_monad_metropolis_pitch_deck.pptx`](presentation/relayproof_monad_metropolis_pitch_deck.pptx).

1. **Cover:** RelayProof and its current evidence boundary.
2. **Official brief:** all four Metropolis tracks; Track 04 prompt examples; explicit fit/gap.
3. **Problem:** media transformation, identity, and truth are separate questions.
4. **Product:** issue, verify, archive, Chromaprint, content preflight, video OCR.
5. **Architecture:** local-first processing and both Chrome extension paths.
6. **Fit + roadmap:** implemented vs optional vs not connected; the steps needed to test post-transcode provenance.
7. **Demo + validation:** passing project checks, runtime gaps, inputs needed, and official sources.

The complete narrated walkthrough is [`video/relayproof_complete_walkthrough.mp4`](video/relayproof_complete_walkthrough.mp4), with captions at [`video/relayproof_complete_walkthrough.srt`](video/relayproof_complete_walkthrough.srt). It is a designed slide-and-diagram walkthrough, not a live screen recording.

---

## 13. Claims to use carefully

### Accurate for the current prototype

- “RelayProof signs a self-asserted source claim and exact-file digest.”
- “The verifier separates signature validation from exact-byte matching.”
- “Optional Chromaprint can surface an uncalibrated candidate audio similarity.”
- “Review and OCR are limited aids that require human checking.”
- “The extension has local-file and user-initiated current-tab audio workflows in code; Chrome runtime testing is still pending.”

### Do not claim

- “RelayProof proves who made the clip,” “proves the clip is true,” or “detects AI audio.”
- “A hash mismatch means fake,” or “a high Chromaprint score proves provenance.”
- “SEBI approved,” “compliant,” “safe,” or “good to go.”
- “Provenance survives re-encoding” until the SBR/watermark recovery path is integrated and measured.
- “Monad integrated/on-chain” until a real contract and verifiable transaction exist.
- “Unique,” “first,” or “no competitors” based on a partial scan.
- Any statement that RelayProof is an official Metropolis entrant, winner, or Monad-endorsed product without evidence.

---

## 14. References and project files

### Official Monad sources

- [Monad Metropolis — official tracks and problem prompts](https://monad.xyz/developers/hackathons/metropolis)
- [Metropolis hackathon portal](https://hackathon.monad.xyz/)
- [Monad Brand & Media Kit](https://monad.xyz/brand-and-media-kit) — official mark/wordmark source used in the deck.

### Technical references

- [AcoustID / Chromaprint](https://github.com/acoustid/chromaprint) — fingerprinting designed for near-identical audio identification; not an identity or truth oracle.
- [pyacoustid on PyPI](https://pypi.org/project/pyacoustid/) — Python interface and local fingerprint comparison utilities.

### Workspace artifacts

- [`LIVE_VERIFIER.md`](LIVE_VERIFIER.md) — live verifier setup, extension setup, dependencies, and limitations.
- [`SBR_API_INTEGRATION.md`](SBR_API_INTEGRATION.md) — fail-closed provider contract, data-safety rules, and the non-secret API details needed to integrate real SBR recovery.
- [`COMPETITOR_COMPARISON.md`](COMPETITOR_COMPARISON.md) — bounded competitor landscape and caveats.
- [`presentation/relayproof_monad_metropolis_pitch_deck.pptx`](presentation/relayproof_monad_metropolis_pitch_deck.pptx) — seven-slide presentation.
- [`video/relayproof_complete_walkthrough.mp4`](video/relayproof_complete_walkthrough.mp4) — complete narrated product walkthrough.
- [`video/relayproof_complete_walkthrough.srt`](video/relayproof_complete_walkthrough.srt) — captions for the walkthrough.
- [`extension/README.md`](extension/README.md) — Chrome extension workflows and setup.

---

**Bottom line:** RelayProof currently demonstrates signed claims and exact-file integrity with optional local review aids. Its most important next proof is genuine, measured provenance recovery after re-encoding. Monad should remain a proposed integration until the product demonstrates why an on-chain record is useful and a real testnet flow exists.
