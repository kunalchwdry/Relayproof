# Problems, fixes, and rating: watermark and registry track

Date: 2026-10-13. Scope: the Metropolis Track 04 problem statement, as published:

> **Trust, Identity & AI Infrastructure.** "Provenance for generated media that survives re-encoding."

The page publishes no judging criteria. The rating below uses the problem statement and general
submission quality.

## 1. Problems found and their status

| # | Problem | Severity | Status |
|---|---|---|---|
| 1 | Watermark too weak: at 20 dB white noise (alpha 1.0), only 1 of 6 clips decoded fully | High | **Fixed.** Default alpha 2.0 gives 6/6 at 20 dB. Costs embedding SNR (29.8 → 23.8 dB). Listening test still needed. |
| 2 | Verify gave up as "ambiguous" when the manifest could pick the right registration | Medium | **Fixed.** `decide()` uses the manifest digest to choose. Unit-tested. |
| 3 | A single bit error caused a false "not registered" (exact ID lookup only) | Medium | **Fixed.** Manifest matches allow up to 2 bit errors. Without a manifest, near matches are reported as "possible", never as a match. |
| 4 | `issue --register` could reuse an ID already on-chain, creating ambiguity | Medium | **Fixed.** Collision guard re-rolls the ID. A fixed ID that is taken fails with a clear message. E2E-tested. |
| 5 | **Claim attack:** anyone can register someone else's watermark ID and file hash, and the forged manifest verified as a match | **High** | **Mitigated, not solved.** `--trusted-issuer` closes it. Off by default, and the weakness is asserted in the test. See §3. |
| 6 | RPC rejects `eth_getLogs` over 100 blocks, so verify crashed | High | **Fixed.** Paged queries. Verified on Monad testnet. |
| 7 | Duplicate registration showed a raw contract revert | Low | **Fixed.** Pre-check with a clear message. |
| 8 | Crashes printed Python tracebacks (bad RPC, missing deployment, missing key) | Low | **Fixed.** Readable errors. |
| 9 | Root `package.json` used `"latest"` for React, Vite, and the plugin | Medium | **Fixed.** Pinned to the versions in the lockfile. `npm ci` clean. |
| 10 | No `.gitignore`. Node modules, build output, and any `*.key` could be committed | Medium | **Fixed.** Added. |
| 11 | Watermark Python env was not reproducible. It broke on a workspace restore (`pip` and packages missing) | High | **Fixed.** Pinned `requirements.txt` and `setup_env.sh`. The venv lives in `~/.cache`, outside snapshots. |
| 12 | Testnet key file reverted to mode 644 after a restore | **High** | **Fixed** (chmod 600). Re-check each session. |
| 13 | Earlier deliverables went missing after a restore: `deploy-pages.yml`, spike `clips/` and `results/`, and the testnet demo artifacts | High | **Fixed.** Workflow and spike data restored. The testnet demo was re-issued (the old manifest could not be recovered). |
| 14 | Spike Piper voice (63 MB) missing from the project, so `make_clips.py` could not run | Low | **Fixed.** `spike/fetch_voice.sh`. |
| 15 | E2E test left a Hardhat node running after every run (`npx` spawned children the trap did not kill) | Medium | **Fixed.** Uses `exec`. Verified no leftover process. |
| 16 | `wm/README.md` numbers and tx references were stale | Low | **Fixed.** Rewritten from the CSVs and the chain. |
| 17 | Hardhat 2.22 has high-severity `npm audit` findings in dev tooling. The only automatic fix is Hardhat 3 (needs Node 22) | Medium | **Open.** Dev-only and not in deployed code. Migrate to Hardhat 3. |
| 18 | Canonical JSON is not RFC 8785 | Low | **Open (documented).** Fine for strings and integers. |
| 19 | Only audio. "Generated media" includes images and video | **High (for the PS)** | **Open.** A scope decision. See §4. |
| 20 | Only synthetic TTS speech, one voice, 6 clips | High (for evidence) | **Open.** Needs a real corpus. |
| 21 | Not in the React app. Static Pages cannot run verify | High (for demo) | **Open.** |
| 22 | Chrome extension capture path never ran in Chrome | Medium | **Open** (from the earlier review). |
| 23 | Two docs disagree on direction (`idea.md` vs the overview) | Medium | **Open.** Team decision. |
| 24 | Metropolis submission deadline is today. The submission itself is not done | High | **Open.** I can't submit for you. |

## 2. Verification

- Unit tests: 19/19 (`python3 -m unittest test_relayproof_wm`, from `wm/`).
- End-to-end on a local chain: 11/11 (`wm/e2e_local.sh`).
- Monad testnet: original, Opus re-encode, tampered manifest, unmarked clip, and no-manifest verify all give the expected verdict.
- Project suites: server 21/21, extension 13/13, credentials 7/7, SEBI 3/3, chain 7/7, build passes.
- Strength sweep and robustness re-run at alpha 2.0 (`spike/results/`).

## 3. The claim attack (most important finding)

The registry is permissionless and binds a manifest only to the address that submitted it. An attacker who knows a file's watermark ID and hash can register a forged manifest for it. Without a trust list, the forged manifest verifies as an active match (asserted in `e2e_local.sh`). With `--trusted-issuer`, it is rejected as an untrusted issuer, and the real manifest still verifies.

This is a real forgery risk for any "who made this" claim. Trust-list verification is a patch. The real fix needs issuer identity: a publisher key, or an allowlist of registered publishers in the contract.

## 4. Rating against the problem statement

Scores out of 10, with a short reason for each.

| Criterion | Score | Reason |
|---|---|---|
| Survives re-encoding | **7** | 6/6 clips keep all 16 bits through Opus, AAC, MP3, resampling, gain, and trims. Tested on synthetic speech only. |
| Survives noise | **6** | 6/6 at 20 dB at alpha 2.0. The cost is audible quality, not yet measured by listening. |
| Covers "generated media" | **3** | Audio only. No image or video. Says nothing about whether media was generated by AI. |
| Provenance strength | **4** | Shows that an address registered a digest at a block. No identity. The claim attack is open by default. |
| Use of the chain | **5** | Gives a public timestamp and revocation. A signed log could do much of the same. The value depends on issuer identity, which is not built. |
| Engineering and tests | **7** | Unit, end-to-end, and testnet checks pass. Pinned environment. Gaps: the claim attack, small corpus, and no UI. |
| Demo and product readiness | **3** | CLI only. Not in the app. Hosting not live. |
| **Overall** | **5 / 10** | A credible prototype of audio provenance with a clear weakness. Not a finished answer to the statement as written. |

## 5. Suggested changes (priority order)

1. **Bind issuers to identity.** Either the contract keeps an allowlist of publishers that only the owner can add to, or the manifest is signed by the publisher's key and the registry stores that key. Without this, the registry proves timing, not origin. This is the change that most improves the score.
2. **Narrow the claim or extend the media.** Either say "audio provenance" in the submission, or add an image watermark track. Do not claim "generated media" for audio alone.
3. **Decide alpha by listening.** Compare `spike/results/example_watermarked_marked_01.wav` with the clean source at alpha 1.5 and 2.0. If 2.0 is audible, use 1.5 and accept the noise limit.
4. **Build a real corpus.** 20 or more real speech clips, several voices, and realistic voice-note bitrates. Report per-transform results with confidence intervals, not just 6/6.
5. **Consider a longer payload.** 16 bits gives about 65k IDs, so collisions grow with registrations. Options: multi-segment payloads with error correction, or a model with more bits.
6. **Add an indexer.** Verify scans events from the deployment block. That gets slower as the registry grows.
7. **Connect the app.** Put the verify step in the React UI, and serve it from a backend, not static Pages.
8. **Migrate to Hardhat 3** to clear the open audit findings. It needs Node 22.
9. **Settle the direction** (`idea.md` vs the overview) and update the overview to match what was built.
10. **Real Chrome test** of the capture path, including the `activeTab` question from the review.

If the submission is due today, items 1 and 2 are the most important to state honestly in the write-up. Items 3 and 4 can be reported as open.
