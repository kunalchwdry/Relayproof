# RelayProof — Media Provenance Recovery Integration (Track 04)

**Scope selected:** media provenance that can survive re-encoding. Passkey/WebAuthn accounts and ERC-8004 agent identity are separate example directions under Track 04 and are out of scope for this RelayProof build.

**Status:** fail-closed adapter contract and readiness endpoint are in place. The actual watermark/SBR provider is **not integrated** because its request/response schema, authentication, and test vectors have not been supplied. No recovery result is simulated or displayed as real.

## Why an adapter is needed

RelayProof's current SHA-256 binding is exact-byte integrity. Re-encoding changes the hash. Chromaprint can return an uncalibrated candidate audio-similarity score, but it is not a watermark or SBR provenance-recovery mechanism.

The provider-specific adapter must connect the media transformation/recovery API to RelayProof's existing signed sidecar. It should return a recovered credential candidate and inspectable evidence. RelayProof will then independently verify the recovered credential signature using its existing verifier. A recovered credential is still not proof of a real-world identity or that its claims are true.

## Current behavior

- `GET /api/health` now reports `sbrAvailable`, `sbrState`, and `sbrMessage`.
- `GET /api/sbr/health` returns the same explicit readiness state.
- With no configured provider, state is `not_configured`; the exact-file workflow remains available.
- There are intentionally **no SBR issue/recovery upload endpoints yet**. Do not point clients at a guessed API or upload private media until the provider contract and data-retention behavior are known.
- The new provider-neutral types and validators are in `server/sbr_contract.py`.

## Provider contract

A provider-specific adapter should implement the `SoftBindingProvider` protocol in `server/sbr_contract.py`:

- `health()` reports actual provider readiness, not just the presence of an environment variable.
- `issue(media, filename, credential)` performs publisher-authorized binding and returns an `SBRIssueArtifact` containing the protected media output and a machine-readable receipt.
- `resolve(media, filename)` returns an `SBRResolution` with exactly one of these states:
  - `recovered`: a credential candidate was recovered; include provider evidence, and the app independently verifies the candidate signature.
  - `no_match`: no recoverable binding was found; this is **not** a fake/forgery verdict.
  - `indeterminate`: the provider could not decide; no authentication conclusion is made.

The normalized result deliberately has no `authentic`, `trusted`, or `same_source` boolean. Issuer trust and media-content truth remain separate decisions.

## Information needed from the API owner

Please provide **sanitized, non-secret** details or documentation:

1. API documentation URL or example request/response with all tokens and personal data removed.
2. Issue/embed endpoint(s) and resolve/recover endpoint(s), HTTP method, media input format, maximum size, and supported containers/codecs.
3. Whether the API embeds a watermark, uses soft-binding resolution, returns a C2PA manifest, or combines methods.
4. For issue: does it return a transformed/protected media file, a sidecar/receipt, a reference ID, or a hosted artifact?
5. For recovery: exact response fields; whether it returns the original signed credential/manifest or only a match score; how issuer signatures are preserved and validated.
6. Provider-side authentication method; whether a server-side secret is required.
7. Media retention/logging policy, location, deletion controls, and whether files are sent to a third party.
8. Supported transformations and any published false-positive/false-negative or recovery measurements, especially for OGG/Opus voice notes.

**Do not share** API keys, bearer tokens, passwords, private keys, or production credentials in chat. If authentication is required, the integration should keep the secret in the local backend environment or a deployment secret manager—never in a `VITE_` variable or browser bundle.

## Security and result-handling requirements

- Upload only after an explicit publisher/reviewer action and clear notice of where the file will be processed.
- Verify the original RelayProof sidecar signature before using its fields as input to the provider.
- Re-verify any recovered RelayProof sidecar locally; never trust a provider's bare `verified: true` as a replacement for RelayProof signature verification.
- Keep exact SHA-256 status, SBR/watermark recovery status, local key pin, and issuer identity as separate UI signals.
- Treat `no_match`, timeout, unsupported media, and provider error as unresolved—not fake.
- Do not make a numeric confidence score into a pass threshold until it is calibrated on representative positive and negative samples.
- Bound file sizes and request timeouts; sanitize provider error bodies and filenames; remove temporary files in a `finally` block.
- Keep secrets server-side. Restrict outbound destinations to the documented provider host; do not accept an arbitrary URL from the browser.
- Never put raw audio/video or private editorial content on Monad. If a later on-chain layer is justified, anchor minimal digests/status events only.

## Validation plan after the API details arrive

1. Map the provider's documented request/response into the typed contract; keep the vendor mapping in its own adapter module.
2. Add fixture-based unit tests for all provider statuses and malformed responses; no live key required in CI.
3. Add a local test mode using non-sensitive known samples, clearly labelled as test fixtures—not fake production results.
4. Test issue → transform/transcode → recover with original credential signature verification.
5. Test negatives: unrelated media, no watermark, wrong sidecar, damaged/trimmed files, unsupported codec, timeouts, and provider errors.
6. Measure recovery and false matches separately by codec, bitrate, duration, trim, noise, and edit; document sample sizes and failures.
7. Add a user-visible result only after these checks; keep “recovered binding” distinct from “trusted issuer” and “true content.”

## Tests added now

Run the provider-neutral contract tests with:

```bash
npm run test:sbr
# or
python3 -m unittest server.test_sbr_contract
```

These tests validate fail-closed readiness, output shape, safe result states, and the rule that `no_match` is not a fake verdict. They do **not** test a real watermark/SBR API.
