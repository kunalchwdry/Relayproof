# RelayProof watermark: spike, issue/verify CLI, and testnet registry (prototype)

Status: prototype. Testnet only. Not audited. Zero paid services. Audio (speech) only.

## Layout

| Path | Purpose |
|---|---|
| `relayproof_wm.py` | CLI. `issue` embeds a 16-bit AudioSeal ID, writes a manifest and receipt, and optionally registers the manifest digest. `verify` detects the ID and checks the registry. |
| `test_relayproof_wm.py` | 19 unit tests for the pure logic (digests, bit helpers, verdict rules). No torch or network needed. |
| `e2e_local.sh` | End-to-end test on a local Hardhat chain: issue, verify, tamper, collision guard, and the claim attack. 11 checks. |
| `demo_claim_attack.py` | Shows the claim attack: a second account registers someone else's watermark ID and file hash. Local chain only. |
| `demo-testnet/` | Real Monad testnet demo: watermarked WAV, Opus re-encode, manifest, receipt. |
| `requirements.txt`, `setup_env.sh` | Pinned Python dependencies and a script that builds the venv in `~/.cache/wm-venv`. |
| `spike/` | Robustness spike, strength sweep, and the synthetic clips. `fetch_voice.sh` downloads the Piper voice used by `make_clips.py`. |

Setup: `wm/setup_env.sh` then `~/.cache/wm-venv/bin/python wm/relayproof_wm.py --help`.
Tests: `python3 -m unittest wm.test_relayproof_wm` from the project root. `wm/e2e_local.sh` needs Node, the `chain/` dependencies, and two local Hardhat dev keys in `E2E_DEPLOY_KEY` and `E2E_ATTACKER_KEY` (the public keys for accounts 0 and 1, printed by `npx hardhat node`). They work only on a local chain. Never use them on a real network.

## Results

Scope: 6 marked and 6 unmarked **synthetic** speech clips (about 5 s each), one TTS voice, one random 16-bit payload per clip. This is a first measurement, not a benchmark. Not tested: real recordings, other voices or languages, music, video, images, or the real WhatsApp/Telegram pipeline.

### Strength chosen: `alpha = 2.0` (the CLI default)

`alpha = 1.0` (the AudioSeal default) is too weak for noisy audio. At 20 dB white noise, only 1 of 6 clips decoded fully. The sweep in `spike/results/alpha_sweep.csv` tried four strengths:

| alpha | Embed SNR (mean) | 25 dB noise: exact 16/16 | 20 dB noise: exact 16/16 | 15 dB noise: exact 16/16 | Unmarked false positives |
|---|---|---|---|---|---|
| 1.0 | 29.8 dB | 4/6 | 1/6 | 1/6 | 0/6 |
| 1.5 | 26.3 dB | 6/6 | 4/6 | 1/6 | 0/6 |
| **2.0** | **23.8 dB** | **6/6** | **6/6** | 3/6 | 0/6 |
| 3.0 | 20.3 dB | 6/6 | 6/6 | 5/6 | 0/6 |

**Trade-off to decide:** alpha 2.0 lowers the embedding SNR from about 29.8 dB to about 23.8 dB. I measured the SNR, not how it sounds. Listen to `spike/results/example_watermarked_marked_01.wav` against the clean source before shipping. If it is audible, use alpha 1.5 and accept the noise limit. The alpha is stored in every manifest, so the choice is recorded.

### Robustness at alpha 2.0 (`spike/results/robustness_alpha2.0.csv`)

| Transform | Detected (prob ≥ 0.5 and 16/16) | Mean detect prob | Min detect prob |
|---|---|---|---|
| none | 6/6 | 1.000 | 1.000 |
| Opus 64k / 32k / 16k | 6/6 each | 1.000 / 1.000 / 0.999 | 1.000 / 1.000 / 0.997 |
| AAC 64k / 32k | 6/6 each | 0.999 / 0.999 | 0.993 / 0.992 |
| MP3 64k | 6/6 | 1.000 | 1.000 |
| Resample 22.05 kHz / 8 kHz | 6/6 each | 1.000 | 1.000 |
| Gain −6 dB | 6/6 | 1.000 | 1.000 |
| Trim first 1 s / keep first 4 s | 6/6 each | 0.998 / 1.000 | 0.995 / 1.000 |
| White noise, 20 dB SNR | 6/6 | 0.686 | 0.624 |

Unmarked controls: 0 false positives out of 6. Highest detection probability 0.012. Best bit match against any payload: 12 of 16, never 16/16.

Note: "detect prob" is the detector's mean over the clip. Noise pulls it down to about 0.6–0.7 even when all 16 bits match, so a fixed 0.5 cut-off is a rough gate, not a calibrated one.

## Monad testnet (chain 10143)

- Registry: `RelayProofRegistry` at `0x833975Bd88b28B25551dc06F0A87B723dd350c00` (deployed at block 70741752). [Explorer](https://testnet.monadscan.com/address/0x833975Bd88b28B25551dc06F0A87B723dd350c00). Record: `chain/deployments/monadTestnet.json`.
- Demo registration (block 70746430, watermark ID 65049): [tx `0x1f4c…1fbe1`](https://testnet.monadscan.com/tx/0x1f4c66c7133911e2333f1382bcbf0631c0ac13a242762a92be4dbb3b621fbe1b). Files in `demo-testnet/`.
- Checked from the chain: original gives `registered_active_manifest_match`. The Opus 32k copy gives the same verdict, through the watermark. A tampered manifest gives `manifest_digest_mismatch`. Unmarked speech gives `no_watermark_detected`. Verify with `--trusted-issuer 0x4E7B…ae35` also passes.
- An earlier demo registration (ID 4243, block 70742481) is still on-chain. Its artifacts were lost in a workspace restore, so it cannot be re-verified with a manifest. It is only a watermark-ID record.
- The deployer is a throwaway testnet wallet, `0x4E7B07B759CfA103d04482C7183913828977ae35`. Its key is in `~/.relayproof-testnet.key` (chmod 600), outside the project.
- Monad's RPC rejects `eth_getLogs` ranges over 100 blocks. `verify` pages through the range, which slows down as the registry grows.

## Security findings

1. **Claim attack (open by default).** Anyone can register a manifest that uses another credential's watermark ID and file hash. The registry accepts it, because it is permissionless. Demonstrated in `e2e_local.sh`:
   - Without a trust list, a forged manifest verifies as `registered_active_manifest_match`. This is the weakness, and the test asserts it so it cannot be forgotten.
   - With `--trusted-issuer <address>`, the forged manifest gives `registered_untrusted_issuer`, and the real one still verifies.
   - Without a manifest, the victim's file gives `ambiguous_watermark_id`. That is a denial-of-verification, not a forgery.
   - **Fix needed:** verifiers must check the issuer against a list they trust. The longer-term fix is to bind issuers to real identities, for example a publisher key that signs the manifest, anchored to a registry entry. That is not built.
2. **16-bit IDs collide.** `issue --register` refuses a registered ID and re-rolls a random one. A verifier can still hit two registrations for one ID, which is reported as ambiguous.
3. **Bit errors.** A manifest-based verify accepts up to 2 wrong bits (`NEAR_TOLERANCE`). Without a manifest, a near match is only "possible_registration_needs_manifest". It is never reported as a match.
4. **Copies rely on the watermark.** Exact-byte matching only works for the original WAV. A copy is linked only by the watermark, and the 16-bit ID is the only link.
5. **`createdAt` is issuer-asserted.** The block time of the registration is the stronger timestamp.
6. **Canonical JSON is not RFC 8785.** For strings and integers it sorts keys and uses compact separators, which is enough for this prototype.
7. **Output is 16 kHz mono.** Inputs are resampled. Stereo, other sample rates, and high-fidelity masters are not preserved.

## Known limits (not solved)

- **Audio only.** The problem statement says "generated media". Images and video are not covered.
- **No real-world corpus.** All speech is synthetic, one voice. Real speech, noisy calls, and platform re-encodes are untested.
- **No UI.** The React app does not call this CLI. The static Pages site cannot run verification.
- **Hardhat 2.22 advisories.** `npm audit` reports high-severity issues in Hardhat 2's dev tooling. The fix is Hardhat 3, which needs Node 22. They are dev-only and not in the deployed code, but they are still open.
- **Registry scan cost.** Verification scans events from the deployment block forward, and gets slower as the registry grows. Needs an indexer.
