# RelayProof competitor watch

**Checked:** 2026-10-10 15:10 UTC  
**Scope:** Curated public GitHub repositories, configured repository-search queries, selected product/spec pages, and tracked implementation issues.
**Interpretation:** Automated change signals only. A commit, page edit, or search hit is not proof of a shipped product, technical capability, or official hackathon entry.

## Scan status — partial

**Baseline coverage:** incomplete.

The latest saved local run refreshed **0 repositories, 0 issues, 6 pages, and 5 searches**, with **15 GitHub API HTTP 403 rate-limit errors**. The four repository rows below are retained observations from an earlier partial run, not fresh checks. The current curated watchlist has since been expanded to version 3: six added repositories (RedoSan Authenticity, C2PA Inspector, Provenance Lens, EM-Audio, a soft-bindings benchmark, and Digimarc’s C2PA extension) plus the ContentLens and Digimarc Chrome Web Store pages. These additions have not yet been checked into a complete baseline. No-change wording applies only to sources that succeeded; failed sources may have changed.

## Changes since last baseline

No tracked changes were established among the sources successfully checked. This scan is incomplete; do not treat the absence of reported changes as a reliable market or competitor conclusion.

## Watched repositories

| Repository | Role | Latest commit | Pushed | Stars |
|---|---|---|---|---:|
| [Musaga-Technology/Grain](https://github.com/Musaga-Technology/Grain) | Metropolis Track 04; onchain image provenance | [Credit an agent's work to the agent by name, once its ERC-8004 identity checks out ](https://github.com/Musaga-Technology/Grain/commit/c233ad3935530ef55ae97d40ef46d052b3989367) | 2026-10-10 15:05 UTC | 0 |
| [amurlaniakea/audiotrust](https://github.com/amurlaniakea/audiotrust) | Local C2PA plus AudioSeal verifier | [Merge pull request #1 from amurlaniakea/fix/license-agpl-3.0 ](https://github.com/amurlaniakea/audiotrust/commit/9496ddc4420de2cfc6efc47e10e620b5c5af23fd) | 2026-08-11 20:36 UTC | 1 |
| [codemyriad/cassini-format](https://github.com/codemyriad/cassini-format) | OpusTags transcript and processing-provenance format | [Merge pull request #6 from codemyriad/ci/run-tests-and-check ](https://github.com/codemyriad/cassini-format/commit/867f68c56292ada9464b8516dc2797003d5af9eb) | 2026-09-28 18:51 UTC | 0 |
| [fullo/Sussurro](https://github.com/fullo/Sussurro) | Speech workbench with planned provenance-marking issues | [Merge pull request #343 from fullo/docs/store-text-fixes ](https://github.com/fullo/Sussurro/commit/84ff05b38cb3168402b984a464ecb64b366f6d93) | 2026-10-04 14:14 UTC | 0 |

## Watched product/spec pages

| Page | Status | Visible text fingerprint |
|---|---|---|
| [AIWatermark audio](https://aiwatermark.com/audio.html) | checked | `6c32653497fad5d8` (2870 chars) |
| [AIWatermark C2PA/conformance](https://aiwatermark.com/c2pa.html) | checked | `9720cc650b35da72` (4689 chars) |
| [AWS SENTINEL audio provenance](https://aws.amazon.com/blogs/media/building-audio-provenance-for-ai-generated-content-at-the-source-with-aws/) | checked | `6f91804fd20da331` (21426 chars) |
| [OpenAI Content Provenance API](https://developers.openai.com/api/docs/guides/content-provenance) | checked | `f91cc20e149cfefa` (22623 chars) |
| [Monad Metropolis Track 04](https://monad.xyz/developers/hackathons/metropolis) | checked | `a616b7525acf2f50` (15558 chars) |
| [Resemble Watermarker](https://www.resemble.ai/products/watermarker) | checked | `7fd6a47f275c73fd` (14090 chars) |

## Search-discovered repositories

Search hits are bounded to the top ten repositories per query and should be reviewed manually.

### AudioSeal implementations
- [themankindproject/audiofp](https://github.com/themankindproject/audiofp) — Audio fingerprinting SDK: Wang landmarks, Panako triplets, Haitsma–Kalker, streaming, file decoding, AudioSeal watermark detection. (pushed 2026-10-08 14:28 UTC; 9 stars)
- [euisuh/audio-command-span-gating-demo](https://github.com/euisuh/audio-command-span-gating-demo) — Small CPU demo: word-level AudioSeal span gating vs utterance-level gating for voice-agent commands. Synthetic TTS; reproduces prior-art ideas. (pushed 2026-10-02 14:49 UTC; 0 stars)
- [rtonf/neutral-tts-workbench](https://github.com/rtonf/neutral-tts-workbench) — Local Japanese TTS workbench for Windows with verified preview, recovery and explicit AudioSeal watermarking (pushed 2026-09-30 04:50 UTC; 0 stars)
- [Silwan5z/neural-audio-watermark-collusion-attack](https://github.com/Silwan5z/neural-audio-watermark-collusion-attack) — Multi-copy collusion attack and framing against modern neural audio watermarks (AudioSeal / WavMark / VoiceMark / WMCodec / TimbreWM). (pushed 2026-09-22 12:12 UTC; 0 stars)
- [CreativeMayhemLtd/provcheck](https://github.com/CreativeMayhemLtd/provcheck) — Local-first C2PA Content Credentials verifier + creator toolkit. Neural-watermark cross-check (silentcipher, AudioSeal, WavMark) and atproto-bound identity. CLI + GUI for Windows/Linux/macOS. Apache-2.0. (pushed 2026-10-05 07:13 UTC; 12 stars)
- [ZachJon1/audioseal-robustness](https://github.com/ZachJon1/audioseal-robustness) — No description. (pushed 2026-09-09 03:44 UTC; 0 stars)
- [navaneethakrishnang273-max/audioseal_-steganographic-watermarker](https://github.com/navaneethakrishnang273-max/audioseal_-steganographic-watermarker) — No description. (pushed 2026-09-03 15:08 UTC; 0 stars)
- [waikato-llm/audio-dataset-converter-audioseal](https://github.com/waikato-llm/audio-dataset-converter-audioseal) — Audio watermarking support using WavMark (https://github.com/facebookresearch/audioseal). (pushed 2026-08-25 21:04 UTC; 0 stars)
- [HawzhinBlanca/hawa-voice-studio](https://github.com/HawzhinBlanca/hawa-voice-studio) — Production Kurdish Sorani TTS Platform — VoxCPM2 & CosyVoice3, 48kHz, AudioSeal watermarking (pushed 2026-08-23 08:24 UTC; 0 stars)
- [rakib-nyc/nullorigin](https://github.com/rakib-nyc/nullorigin) — Research-only AI watermark & provenance robustness toolkit: local reverse proxy (OpenAI/Anthropic/Gemini) + CLI stripping C2PA/EXIF/XMP, zero-width & homoglyph Unicode, KGW text watermarks, DWT/Tree-Ring image stego, AudioSeal, PDF/DOCX/PPTX/XLSX metadata, and Trojan Source (CVE-2021-42574) code scanning. (pushed 2026-08-16 20:13 UTC; 4 stars)

### C2PA audio implementations
- [juanlentino/sealedrecord](https://github.com/juanlentino/sealedrecord) — Verify a sealed session record: hash chain, Ed25519 signatures, time receipts, and audio anchors. Library, CLI, and browser verifier in one package. (pushed 2026-10-09 18:11 UTC; 0 stars)
- [provemark/tracefern-image-check](https://github.com/provemark/tracefern-image-check) — WordPress plugin that verifies the Content Credentials (C2PA) of uploaded images, audio and text and shows the result in the Media Library. (pushed 2026-10-09 16:17 UTC; 0 stars)
- [Redo-San/RedoSan-Authenticity](https://github.com/Redo-San/RedoSan-Authenticity) — Beta tool for embedding and verifying digital authenticity in images, audio, and video using watermarks, C2PA, and steganography. (pushed 2026-10-09 11:59 UTC; 1 stars)
- [VINASIG/metadata-reader](https://github.com/VINASIG/metadata-reader) — Inspect file metadata and supported C2PA origin claims locally in the browser. Filter grouped fields, view raw values and export JSON. (pushed 2026-10-08 12:50 UTC; 0 stars)
- [1D-Coda/em-audio](https://github.com/1D-Coda/em-audio) — Reference implementation and reproducibility package for an evidence-monotone operator contract on derived audio: sample-exact interval provenance, declared kernel footprints, and a C2PA signed transport. Includes an independent third-party reproduction. (pushed 2026-10-06 10:33 UTC; 0 stars)
- [Blimp3/provenance-lens-extension](https://github.com/Blimp3/provenance-lens-extension) — Chromium Manifest V3 extension for user-triggered checks of C2PA Content Credentials in images and supported OpenAI provenance signals in images and short audio, not an AI detector. Credential-free MIT source edition with optional DigiBot pairing to send a page's video to Telegram. (pushed 2026-10-10 10:16 UTC; 0 stars)
- [Original-Pictures/soft-bindings-benchmark](https://github.com/Original-Pictures/soft-bindings-benchmark) — Open-licence benchmark of invisible watermarks and content fingerprints as C2PA soft bindings for images, audio and video: code, results and preprint source (pushed 2026-10-02 01:10 UTC; 0 stars)
- [ivanusto/unmark-web](https://github.com/ivanusto/unmark-web) — Independent browser-first client that strips invisible Unicode marks and C2PA/EXIF/XMP/ID3 metadata from text, images, audio and video locally, or via the watermarks-remover Python service (MIT) (pushed 2026-10-01 01:18 UTC; 15 stars)
- [eddorre/ruby-c2pa](https://github.com/eddorre/ruby-c2pa) — Embed and verify C2PA content provenance and authenticity credentials in images, video, and audio files. Ruby bindings for the official Rust c2pa-rs library. (pushed 2026-09-30 06:16 UTC; 0 stars)
- [richardwooding/c2pa-inspector](https://github.com/richardwooding/c2pa-inspector) — Check whether a photo, video, audio file or PDF was AI-generated or edited since signing — full C2PA / Content Credentials validation running entirely in your browser. Pure Go compiled to WebAssembly; nothing is uploaded, no account, no tracking. (pushed 2026-10-05 13:44 UTC; 0 stars)

### General audio provenance projects
- [GauriSaraf05/Multimodal-Framework-for-AI-Generated-Content-Detection-Provenance-Tracing](https://github.com/GauriSaraf05/Multimodal-Framework-for-AI-Generated-Content-Detection-Provenance-Tracing) — A multimodal framework to detect AI-generated content and distinguish it from human-created content. It provides a Trust Score, confidence, and explainable results, with future support for text, images, and audio. (pushed 2026-10-10 13:16 UTC; 0 stars)
- [wachin/song-chord-lyrics-analyzer](https://github.com/wachin/song-chord-lyrics-analyzer) — A cross-platform, offline-first laboratory that analyzes an audio song and produces a synchronized representation of its lyrics, chords, beats, tempo and key — with confidence and provenance attached to every inference (pushed 2026-10-10 00:33 UTC; 0 stars)
- [juanlentino/sealedrecord](https://github.com/juanlentino/sealedrecord) — Verify a sealed session record: hash chain, Ed25519 signatures, time receipts, and audio anchors. Library, CLI, and browser verifier in one package. (pushed 2026-10-09 18:11 UTC; 0 stars)
- [provemark/tracefern-image-check](https://github.com/provemark/tracefern-image-check) — WordPress plugin that verifies the Content Credentials (C2PA) of uploaded images, audio and text and shows the result in the Media Library. (pushed 2026-10-09 16:17 UTC; 0 stars)
- [perandre/zotero-audio](https://github.com/perandre/zotero-audio) — Local, provenance-preserving Zotero PDF to AAC/M4A pipeline for macOS (pushed 2026-10-09 07:52 UTC; 0 stars)
- [HarperZ9/gather](https://github.com/HarperZ9/gather) — Research intake that reaches the hard places: web, video, papers, scanned PDFs, browser, OCR, and audio into structured research packets. DOM extraction and change tracking built in; provenance rides along on every item. (pushed 2026-10-09 04:08 UTC; 4 stars)
- [sonicfieldlabs/MASA](https://github.com/sonicfieldlabs/MASA) — MASA — A local-first, language-neutral protocol for describing, listening to, granulating, dissecting, and exchanging sound as matter, with engine-neutral processing and agentic tooling (CLI, MCP, skills). (pushed 2026-10-09 13:58 UTC; 1 stars)
- [cocombee/AlQuran-OpenSource](https://github.com/cocombee/AlQuran-OpenSource) — Open production tools for free spoken Quran translation editions, with source provenance and human review. (pushed 2026-10-08 08:40 UTC; 0 stars)
- [backblaze-labs/genblaze](https://github.com/backblaze-labs/genblaze) — Genblaze is an open source Python SDK for orchestrating generative AI media pipelines across video, audio, and image providers with built in provenance for every output. (pushed 2026-10-08 05:45 UTC; 550 stars)
- [tuckn/tkn_audio_transcriber](https://github.com/tuckn/tkn_audio_transcriber) — CLI that turns an audio file, or the audio stream inside a video file, into a Markdown transcript, SRT subtitles, JSONL segments, and a provenance manifest.  (pushed 2026-10-06 22:53 UTC; 0 stars)

### Metropolis Track 04 projects
- [isiomaC/warden-anchor](https://github.com/isiomaC/warden-anchor) — Anchor Warden decision logs on Monad so rewrites and truncation are detectable offline. Monad Metropolis, Track 04. (pushed 2026-10-10 14:47 UTC; 0 stars)
- [nel349/pod](https://github.com/nel349/pod) — Agents get paid only when somebody else can re-run the work. Monad Metropolis, track 04. (pushed 2026-10-10 08:19 UTC; 0 stars)
- [AmitChowdary122/attest8004](https://github.com/AmitChowdary122/attest8004) — The ERC-8004 Validation layer for Monad: passkey-appoved agent mandates, re-executable + agentic validatrs, and an onchain gate any contract can check. Mona Metropolis 2026, Track 04. (pushed 2026-10-06 18:52 UTC; 0 stars)
- [catchmeifyoucaan/witness](https://github.com/catchmeifyoucaan/witness) — Non-custodial P256 passkey smart account for Monad. Track 04 Metropolis. (pushed 2026-10-05 15:24 UTC; 0 stars)
- [roboledger-latam/roboledger-latam](https://github.com/roboledger-latam/roboledger-latam) — Contratación de robots y agentes autónomos con identidad verificable, skills evaluadas y tesorería en Monad. Monad Metropolis, Track 04. (pushed 2026-10-04 15:14 UTC; 0 stars)
- [norbert351/merit](https://github.com/norbert351/merit) — Merit - sybil-resistant, settled-money-weighted agent reputation for Monad (Metropolis Track 04) (pushed 2026-10-02 14:55 UTC; 0 stars)
- [zuemen/agent-passport](https://github.com/zuemen/agent-passport) — Verifiable identity & selective-disclosure mandates for AI agents (ERC-8004) — checked on Monad. Monad Metropolis Track 04. (pushed 2026-09-30 04:27 UTC; 0 stars)
- [filip-study/agent-pay-monad](https://github.com/filip-study/agent-pay-monad) — Agent payment + identity discovery on Monad (Metropolis Track 04) — x402/USDC tip + ERC-8004-style agent card (pushed 2026-09-26 10:01 UTC; 0 stars)

### Opus audio provenance projects
- [codemyriad/cassini-format](https://github.com/codemyriad/cassini-format) — An ordinary .opus audio file that carries its own word-timestamped transcript, speakers and provenance in its OpusTags. (pushed 2026-09-28 18:51 UTC; 0 stars)

## Sources that could not be checked

- `CreativeMayhemLtd/provcheck` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `Musaga-Technology/Grain` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `amurlaniakea/audiotrust` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `c2pa-org/softbinding-algorithm-list` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `codemyriad/cassini-format` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `facebookresearch/audioseal` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `fullo/Sussurro` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `https://api.github.com/repos/fullo/Sussurro/issues/240` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `https://api.github.com/repos/fullo/Sussurro/issues/257` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `louissarvin/gapless` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `resemble-ai/Perth` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `rtonf/neutral-tts-workbench` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `themankindproject/audiofp` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `wngstnr-code/origo` — request failed: HTTPError: HTTP Error 403: rate limit exceeded
- `yyf/ai-audio-provenance` — request failed: HTTPError: HTTP Error 403: rate limit exceeded

## Follow-up

Open `COMPETITOR_COMPARISON.md` before changing product positioning. A human should inspect any new candidate or changed page and update that curated comparison only after verifying what actually shipped.
