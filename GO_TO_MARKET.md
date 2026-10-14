# RelayProof: Go-to-Market Strategy

Status: draft for discussion, 13 Oct 2026. Based on the prototype as built, not on customer data. Every assumption that still needs validation is marked **[validate]**. This is a business plan, not legal advice. Have counsel check the compliance claims before any customer relies on them.

---

## 1. What we are selling (and what we are not)

**One sentence:** RelayProof marks synthetic speech so that its origin can be verified after it has been compressed, re-encoded, or shortened, and it records the registration on a public ledger.

**What the prototype does today** (from `wm/README.md`):
- Embeds a 16-bit ID in speech with AudioSeal (open source, MIT).
- Survives Opus, AAC, MP3, resampling, gain change, and trimming on the 6 synthetic clips tested.
- Survives 20 dB white noise at strength α = 2.0, at a cost in audio quality that is not yet measured by listening.
- Registers a manifest digest on a Monad testnet contract, and verifies it.

**What it does not do yet:**
- It does not prove who the issuer is. Anyone can register a forged manifest for someone else's ID (the "claim attack", `wm/PROBLEMS_AND_RATING.md` §3).
- It covers audio only. Images and video are out of scope.
- It has been tested only on synthetic TTS speech, with one voice.
- It has no UI, no hosted verification service, and no SDK.

**What we are not:** a deepfake detector. Detectors guess from the sound. RelayProof works only when the generator has marked the audio. That single fact drives most of the strategy below.

---

## 2. The market and why now

### 2.1 Regulation creates the buyer

- **EU.** Article 50 transparency obligations have applied since 2 August 2026. Providers of generative systems must mark synthetic audio, image, video, and text in a machine-readable, detectable format. Deployers must disclose deepfakes. Systems already on the EU market have until 2 December 2026 to comply with the marking duty, and the marking duty does not apply where a tool only makes assistive edits that leave the input's meaning unchanged. Sources: [1](https://www.bakerbotts.com/thought-leadership/publications/2026/september/eu-ai-act-article-50-transparency-obligations-go-live), [2](https://www.regulation-ai.eu/en/transparency-obligations/), [3](https://vois.so/blog/eu-ai-act-voice-disclosure-creators). Fines reach €15 million or 3% of worldwide turnover ([4](https://bratby.law/ai-act-transparency-obligations-2026/)). **Buyer:** voice-AI providers that sell into the EU, including non-EU companies whose output reaches EU users.

- **India.** The IT Rules amendment in force since 20 February 2026 requires permitted synthetic content to be labelled. Audio needs a spoken disclosure, not only a visual label. Permanent metadata or a unique identifier is required "to the extent technically feasible". Platforms must not let anyone strip the label or the identifier ([5](https://www.legal500.com/intelligence/india/technology/indias-new-frontier-in-digital-content-and-ai-regulation-navigating-the-synthetically-generated-information-regulation-under-the-information-technology-intermediary-guidelines-and-digital-media-ethics-code-amendment-rules-2026), [6](https://lexplosion.in/meity-notifies-information-technology-intermediary-guidelines-and-digital-media-ethics-code-amendment-rules-2026-introducing-compliance-framework-for-synthetically-generated-information-and-revisin/)). Sources differ on takedown windows: most cite two hours for the most harmful categories and three hours for other unlawful content ([7](https://maliktimes.in/ai-content-labelling-rules-india-2026-explained/), [8](https://verda.ai/compliance/india-it-rules-ai-content/)). **Buyer:** platforms and intermediaries, who carry the duty. Publishers and creators are the second buyer, because the duty flows down to them.

**Implication:** "embedded, permanent identifier, traceable to the generating resource" is exactly the requirement RelayProof addresses. This is the sales message that matters most in India.

### 2.2 Competitors and the open-source floor

| Player | What they offer | Where they are strong | Where we can differ |
|---|---|---|---|
| Google SynthID (audio) | Watermark for supported Google audio (Lyria, NotebookLM), with a public detector ([9](https://www.eyesift.com/blog/does-elevenlabs-watermark-audio/)) | Scale, and a detector anyone can use | Covers Google's outputs only. Not a vendor-neutral service for other providers. |
| Resemble AI (PerTh) | Watermark at generation time, detection, source tracing, on-prem option ([10](https://www.resemble.ai/resources/best-voice-watermarking-tools-in-2026)) | Enterprise voice market, deployments on-prem | Closed platform bundle. We can offer an open, auditable registry and an independent verifier. |
| Digimarc | Audio identity and broadcast monitoring ([10](https://www.resemble.ai/resources/best-voice-watermarking-tools-in-2026)) | Rights and royalty tracking at scale | Not built around generated-voice provenance. |
| Meta AudioSeal | Open-source watermark generator and detector ([10](https://www.resemble.ai/resources/best-voice-watermarking-tools-in-2026)) | Free, research-grade | No product, no registry, no compliance layer. This is our base layer. |
| Steg.AI, IMATAG | Forensic watermarks, mainly for leak tracing and images | Distribution and leak tracing | Not voice-generation-focused. |
| OpenAI, Anthropic | Own provenance programmes; OpenAI's checker now covers some audio via SynthID and C2PA ([11](https://wp-nitin.com/blog/ai-watermarking-google-openai-anthropic/)) | Their own outputs | Only their own outputs. |

**The uncomfortable conclusion:** the watermark algorithm is free. Anyone can build what we built, starting from AudioSeal. Our defensibility has to come from:

1. **A neutral, multi-provider registry** that a verifier can trust without trusting any one vendor. This requires identity binding (see §6), which we do not have yet.
2. **Compliance packaging.** Mapping to Article 50 and the India SGI rules, with audit logs and reports that a compliance team can file.
3. **Distribution** into the workflows where audio is made and published (voice-AI APIs, podcast hosts, CMS, audio editors).
4. **Verification volume.** Every verification is a data point, and a large verifier network makes marks worth more.

---

## 3. Ideal customers, in priority order

### Tier 1: Voice-AI providers (sell marking as a feature)
- **Who:** TTS and voice-cloning startups in India and the EU, plus any company whose voice product reaches EU users.
- **Why first:** they are the "provider" under Article 50(2), so the duty is theirs and the deadline is real. They can integrate an API into their generation pipeline.
- **What they buy:** a marking API or SDK in the generation path, an audit log, a compliance report, and a public verification endpoint their customers and regulators can use.
- **Objections to expect:** latency, audio quality cost (α = 2.0 lowers embedding SNR to about 24 dB, **[validate]** by listening tests), and "we already use SynthID or PerTh".
- **Our answer:** open, auditable registry plus multi-provider verification. Offer a lower-strength mode for quality-sensitive products, and be honest about the 20 dB noise limit.

### Tier 2: Publishers of AI-narrated audio (podcasts, audiobooks, news audio, regional-language content)
- **Who:** the deployers. They must disclose under Article 50(4) and label under India's rules.
- **Why:** the disclosure duty lands on them even when the tool vendor did the marking. Some of them publish a lot of audio (**[validate]** typical volume).
- **What they buy:** a self-serve "mark and register" flow for published audio, a verification badge, and a disclosure-text generator.
- **Channel:** podcast hosting and audiobook platforms, which can offer RelayProof as an optional add-on.

### Tier 3: Newsrooms, fact-checkers, and verification teams
- **Who:** people who need to answer "did our outlet publish this clip?" or "is this clip from a registered source?"
- **Why:** they feel the pain now, they buy small amounts quickly, and they give credibility and case studies.
- **What they buy:** a verifier with a clear verdict and a human-readable report. They are the best design partners and will tolerate a rough product.
- **Caution:** they will also be the first to find the claim attack. Make the trust model clear before they rely on it.

### Tier 4: Platforms and intermediaries (large, long sales cycle)
- **Who:** social and audio platforms with India's SSMI duties.
- **Why later:** they need detection at ingest and a provenance check, which needs large-scale testing (see §7). Procurement takes many months.
- **What they buy:** a bulk verification API, an SLA, and reports for regulators.

### Not targeted now
- **Banks and telcos for live voice-fraud detection.** Our watermark only helps if the call's audio was marked by a generator that cooperates. Fraud calls will not be marked. Detection is a different product.
- **Images and video.** Out of scope until a second model is built and tested.

---

## 4. Positioning and messaging

**Positioning:** "The verifiable label for synthetic voice. It survives compression, and anyone can check it."

**Message by buyer:**
- *Voice-AI providers:* "Article 50(2) marking as one API call. Open verification, so your customers and regulators do not have to trust us."
- *Publishers:* "Disclose AI narration with proof. Your label survives re-encoding, and your registration is public."
- *Newsrooms:* "Check whether a clip came from a registered source, and see exactly what the check can and cannot prove."
- *Platforms:* "Permanent identifiers for synthetic audio, with an audit trail for the due-diligence duty."

**Words to avoid:**
- "Detects deepfakes." We do not, and we will be discredited if we say it.
- "Blockchain-secured." The chain provides a public timestamp and a revocation record. It does not verify who the issuer is. Say that precisely.
- "Unbreakable." The noise and identity limits are in the README. Say what the system does not defend against.

**Proof points to build (in order of value):**
1. A listening test showing α = 2.0 is or is not audible to listeners (**[validate]**).
2. A real corpus: 20 or more real recordings, several voices, several languages, realistic voice-note bitrates, with confidence intervals.
3. A public demo: a clip marked, re-encoded through common codecs, and verified live.
4. A published threat model that names the claim attack and the mitigation.

---

## 5. Product and packaging

### 5.1 What must exist before a paid pilot
| Item | Why | Status |
|---|---|---|
| Hosted verification API | Partners cannot run a local CLI | Not built. The Vercel site is front-end only. |
| Marking SDK (Python and JS) wrapping `relayproof_wm.py` | Providers integrate in their pipeline | Not built. The CLI exists. |
| Issuer identity binding | Without it, the registry proves timing and not origin | **Not built. Blocker for enterprise sales.** |
| Trust list management | Verifiers must choose whom to trust | CLI flag only (`--trusted-issuer`) |
| Audit log and compliance report | Regulated buyers need evidence | Not built. |
| Listening test and real corpus | Required for any credible claim | Not built. |
| Legal review of compliance mapping | Avoid claiming compliance we do not have | Not started. |

### 5.2 Pricing (proposal, to validate)
- **Free: Creator.** Up to a small monthly number of verifications and marks, with the public registry and a verify page. This builds trust and a verification network. Cost to us is the chain fee and compute, both small.
- **Pro: usage-based.** Price per minute of audio marked, plus a fixed monthly platform fee. Price to test in pilots: **[validate]** willingness to pay.
- **Business: platform and enterprise.** Bulk verification API, SLA, on-prem or private-registry option, issuer identity administration, and compliance reports.

**Blockchain cost:** testnet fees are paid in free test tokens, so the testnet tells us nothing about real cost. Measure mainnet fees before pricing. Keep the registry behind an interface, so a signed, transparency-log version can replace the chain for buyers who do not want it. Many regulated buyers will not care about a public chain. What they need is an auditable log.

### 5.3 Open source as a go-to-market tool
Publish the CLI, the spike, and the unit and end-to-end tests under a permissive license. Reasons:
- AudioSeal is already open, so the algorithm is not a secret. Trust comes from being able to inspect the verifier.
- Developers adopt tools they can run themselves, which feeds the Tier 1 funnel.
- It turns the open-source base into a visible, credible reference, not a black box.

Keep the hosted registry, identity service, and compliance packaging closed or paid.

---

## 6. Trust is the product

The main risk is not technical. It is that a verdict is wrong in a way that matters. The claim attack from the prototype is the clearest example. Before selling to any buyer who will rely on a verdict, we must:

1. **Bind issuers to identity.** Options: a publisher allowlist that only we (or a governance body) can edit; or manifests signed by a publisher key, with the key anchored in the registry. The allowlist is faster to build and easier for buyers to understand. Signed manifests are the better long-term design.
2. **Show the issuer on every verdict**, so the verifier, and the public, see who claimed the file.
3. **Publish the verdict rules** (`decide()` in `relayproof_wm.py`), so a buyer's lawyer can read exactly when we say "match".
4. **Publish known failure modes** on the verification page: noise limit, ID collisions, audio-only coverage, re-encoding not tested beyond the set in the README.

If we skip identity binding and sell to newsrooms or platforms anyway, the first public forgery will end the company's credibility. This is the biggest sequencing risk in the plan.

---

## 7. Phased plan

### Phase 0: Validate (weeks 1–4)
- **Customer discovery:** 15 interviews with voice-AI startups (India and EU), 5 podcast or audiobook producers, 5 newsroom or fact-check teams.
- **Test the core claim:** would a provider integrate a marking step in the pipeline? Would a publisher pay for a registration? Would a newsroom use a verifier?
- **Technical validation in parallel:** listening test, real-speech corpus, and identity-binding design.
- **Deliverable:** a go/no-go memo with price points, objections, and at least 3 design partners who agree to a pilot.

### Phase 1: Build the minimum credible product (weeks 4–10)
- Hosted verification API with a public verify page.
- Marking SDK for Python and JS.
- Identity binding (allowlist version first).
- Compliance mapping document, reviewed by counsel.
- Audit log export.
- Real-speech corpus and results published with the threat model.

### Phase 2: Paid pilots (months 3–6)
- 3 to 5 paid design partners, from Tier 1 and Tier 3.
- Measure: partner output marked (%), verifications per week, false verdicts reported (target: zero confirmed wrong "match" verdicts), time to verify, and whether partners renew.
- Start one distribution partnership with a podcast host or audio editor.
- Start C2PA interoperability: write the manifest in a format that C2PA tools can read, so we are not an island. (Note: `c2patool` does not read OGG, per our earlier review, so this needs a plan for container formats.)

### Phase 3: Scale (months 6–12)
- Platform and intermediary sales (Tier 4), with bulk verification and SLA.
- Second modality (image or video) only if pilots show demand.
- Move to a managed registry with governance: publisher onboarding, dispute process, and revocation policy.

---

## 8. Channels

| Channel | Target | Action |
|---|---|---|
| Direct outreach | Tier 1 and Tier 3 | Founder-led, targeted at voice-AI startups in India and the EU |
| Open-source community | Developers | Publish the CLI and spike; write a technical post on the alpha trade-off |
| Compliance content | Compliance teams, legal | Plain-language guides to Article 50 and India SGI, with a clear "what this does not cover" section |
| Hackathon and ecosystem | Early users, credibility | Metropolis (submission due today per the event page), other Monad and AI-provenance events |
| Partnerships | Distribution | Podcast hosts, audio editors, CMS vendors, voice-AI marketplaces |
| Standards bodies | Credibility | C2PA community, EU and India working groups where open |

---

## 9. Metrics

| Stage | Metric | Target (proposal, **[validate]**) |
|---|---|---|
| Discovery | Interviews completed; design partners signed | 25 interviews; 3 partners |
| Pilot | Share of partner output that is marked | Above 90% of eligible output |
| Pilot | Verifications per week per partner | Set after discovery |
| Trust | Confirmed wrong "match" verdicts | Zero, with a public log of every dispute |
| Quality | Listening-test preference for marked vs clean | Not significantly worse, or the setting changes |
| Revenue | Paid pilots converted to contracts | 2 of 3 |

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Claim attack causes a public forgery | High today | Severe | Identity binding before any high-stakes buyer (§6) |
| Open-source or big-tech copy | High | High | Compete on distribution, compliance packaging, and the neutral registry |
| Marking only helps if generators opt in | High | High | Start with providers who have a legal duty (Tier 1) |
| Regulation changes or is delayed | Medium | Medium | Product is useful beyond compliance (verification for newsrooms) |
| Audio quality cost is audible | Medium | High | Listening test; offer a strength setting |
| Real-world re-encoding is worse than tested | Medium | High | Real corpus before any performance claim |
| Legal liability for a wrong verdict | Medium | High | Clear terms, "what it can prove" statements, counsel review |
| Chain cost or chain risk on mainnet | Low to medium | Medium | Abstract the registry; offer a non-chain option |
| Dependence on one team member's machine | High today | Medium | Pinned env and tests already in repo; move to CI |

---

## 11. Next 30 days (concrete)

1. Book the 25 discovery interviews (start with the voice-AI startups in the EU and India).
2. Run the listening test on the existing samples, and publish the result.
3. Build a 20-clip real-speech corpus.
4. Write the identity-binding design (allowlist version) and decide the signed-manifest timeline.
5. Get a counsel review of the Article 50 and India SGI mapping.
6. Pick 3 design partners and offer a free pilot in exchange for feedback and a case study.
7. Decide: continue, pivot to a narrower wedge (e.g. newsroom verification), or stop, based on the Phase 0 memo.

---

## Sources

1. [Baker Botts, EU AI Act Article 50 go-live](https://www.bakerbotts.com/thought-leadership/publications/2026/september/eu-ai-act-article-50-transparency-obligations-go-live)
2. [Regulation-AI, Article 50 guide](https://www.regulation-ai.eu/en/transparency-obligations/)
3. [Vois, EU AI Act audio disclosure for creators](https://vois.so/blog/eu-ai-act-voice-disclosure-creators)
4. [Bratby Law, AI Act transparency obligations](https://bratby.law/ai-act-transparency-obligations-2026/)
5. [Legal500, India SGI regulation](https://www.legal500.com/intelligence/india/technology/indias-new-frontier-in-digital-content-and-ai-regulation-navigating-the-synthetically-generated-information-regulation-under-the-information-technology-intermediary-guidelines-and-digital-media-ethics-code-amendment-rules-2026)
6. [Lexplosion, MeitY amendment rules 2026](https://lexplosion.in/meity-notifies-information-technology-intermediary-guidelines-and-digital-media-ethics-code-amendment-rules-2026-introducing-compliance-framework-for-synthetically-generated-information-and-revisin/)
7. [Malik Times, AI content labelling rules India 2026](https://maliktimes.in/ai-content-labelling-rules-india-2026-explained/)
8. [Verda, India IT Rules AI labelling](https://verda.ai/compliance/india-it-rules-ai-content/)
9. [EyeSift, ElevenLabs watermarking and SynthID](https://www.eyesift.com/blog/does-elevenlabs-watermark-audio/)
10. [Resemble AI, voice watermarking tools 2026](https://www.resemble.ai/resources/best-voice-watermarking-tools-in-2026) (vendor comparison; treat its claims as the vendor's own)
11. [Nitin Arya, AI watermarking in 2026](https://wp-nitin.com/blog/ai-watermarking-google-openai-anthropic/) (secondary source; verify before quoting)
12. [Meta AudioSeal (MIT, open source)](https://github.com/facebookresearch/audioseal)
13. Internal: `wm/README.md`, `wm/PROBLEMS_AND_RATING.md`, `REVIEW_FACT_CHECK_2026-10-13.md`
