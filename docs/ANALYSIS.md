# Video analysis: how it works, what was tested, and what is not verified

The "Analyse video" page plays a clip, reads frames, checks the words, reads Content Credentials, and raises pop-up alerts for high-priority findings. Every result is a lead for a person to check. None of it is a verdict on authenticity.

## Pipeline

1. **Limits check (browser, `src/analysis/mediaCheck.js`).** Files up to 500 MB and clips up to 60 minutes. For MP4 and MOV, the page reads the container to see whether there is a sound track. Nothing is uploaded.
2. **Content Credentials (browser, `src/analysis/provenance.js`).** The C2PA library loads only when a clip is analysed. It reads the file's signed credentials: who signed it, which tool made it, whether it declares AI generation or AI editing, the recorded edits, and whether the signature and hashes still match. The file is not uploaded.
3. **Scan (browser).** The clip is stepped through at thumbnail size. The page measures how much each moment changes from the one before. If every scanned thumbnail is black, the page stops here and says so. Nothing is sent. This is the case when the browser cannot decode the codec, for example H.265/HEVC in some browsers.
4. **Choose moments (browser, `src/analysis/sampling.js`).** Up to 16 moments are kept: the biggest changes first (cuts, new on-screen content), then even coverage of the whole clip.
5. **Capture (browser).** Only those moments are captured at full size (960 px, JPEG, under 480 KB). The full video is never uploaded.
6. **Frame analysis (`POST /api/nim/analyze-frames`).** Frames go to an NVIDIA NIM vision model, four at a time. Each frame returns the visible on-screen text and a list of issues with a category and severity. A timeout, overload, or network error is retried once.
7. **Speech (browser, optional).** If the transcript box is empty and "Transcribe the speech in this browser" is ticked, Whisper tiny runs on the device (about 41 MB the first time, English only). A clip with no sound track skips this step. Typed or uploaded captions always win.
8. **Text analysis (`POST /api/nim/analyze-text`).** The transcript and on-screen text go through a content-safety model, a scam-pattern scan, and claim extraction. For each claim, the page first looks for a published fact check (Google Fact Check Tools, `FACT_CHECK_API_KEY`). If none matches, it runs a live web search (SerpAPI, `SERPAPI_KEY`). Each claim records which source it used, and the verdict may cite only those snippets.
9. **Findings (`src/analysis/findings.js`).** Pure rules decide what becomes a pop-up, what becomes a review item, and what goes on the timeline.
10. **Report.** "Export report (JSON)" downloads every finding with its time, the claims with their sources, and the provenance result. Frame pictures are left out.

## What raises a pop-up

| Source | Pop-up when |
| --- | --- |
| Frame issue | category is illegal content, violence, sexual content, or scam visual, at medium or high severity |
| Text safety | the content-safety model flags the text as unsafe |
| Scam scheme | any scheme flag is found in the text |
| Claim | the verdict is "contradicted", or the logic check finds a problem |

Visual inconsistencies and "possible synthetic artifacts" never raise a pop-up on their own. They appear as review items.

The pop-up is keyboard-operable: focus moves in when it opens, Tab and Shift+Tab stay inside it, Escape closes it, and focus returns to the control that opened it.

## Authenticity: what is and is not checked

- **Content Credentials (C2PA): checked in the browser.** It reports signer, tool, declared AI generation or editing, recorded edits, and signature status. The page labels a signer that is not on a trust list as "not checked against a trust list". "No credentials" is shown as "not evidence either way".
- **Reverse-image search: links only.** Each frame can be downloaded, and there are plain links to Google Lens, TinEye, and Bing Visual Search. The user uploads the frame there. The app calls none of these services.
- **AI-generated or deepfake content: not checked automatically.** No free detector can do this reliably.

Why no automatic AI check: we tested free models before shipping a browser check, and none could tell real images from generated ones.

| Model (free, open) | Test | Result |
| --- | --- | --- |
| prithivMLmods/AI-vs-Deepfake-vs-Real-ONNX (8-bit, 87 MB) | 4 real photos, 4 generated images | 50% accuracy (chance) |
| Organika/sdxl-detector (fp32, 354 MB, non-commercial licence) | same set, with the model's own normalisation | 50% accuracy (chance) |
| ninini1/AI-image-detector (fp32, 354 MB) | same set | 50% accuracy (chance) |
| NVIDIA synthetic-video detector | catalog call | internal error on this key |

The set was small (8 images), so this is evidence against these models, not a full benchmark. A real check needs a paid detection API that you approve, or a larger labelled evaluation. Neither is in place.

## Speech: optional, verified outside the browser

- **Model:** Whisper tiny, 8-bit, Apache 2.0. It runs on the CPU only (`device: 'wasm'`), with one thread.
- **Checked:** `npm run verify:speech -- clip.wav` runs the same model and options on a 30-second clip from the walkthrough. It printed a correct transcript with timestamps in about 4 seconds.
- **Not checked in a browser:** in this test sandbox, the browser ran out of memory while loading the model, even at 41 MB. The page's speech step is therefore unverified in a browser. Run it on a normal machine before relying on it. The typed-transcript path is verified end to end.
- **Limits:** English only. Hindi and Hinglish will be poor. Clips over 40 minutes are not transcribed. Noisy audio gives errors. On a laptop with 8 GB of memory or less, a long clip can run out of memory. The page then says so and asks for a pasted transcript.

## Cancel

"Cancel analysis" stops the run at its next step: frame capture, each NVIDIA call, and the wait between retries. Nothing from a cancelled run is kept. Two limits:

- The in-browser speech model cannot be interrupted once it has started. Its result is discarded, but it finishes in the background.
- The NVIDIA call that is already running finishes on the server, and its result is discarded.

## Tested

Automated, run on each push by `.github/workflows/ci.yml` (unit tests, build, credential scan, and browser tests with NVIDIA mocked):

- Unit tests: findings, captions, frame choice, retries and cancel, provenance mapping (on real C2PA library output), fact-check mapping and evidence order, media checks, report builder, credential scanner.
- Browser: cancel, full run, Content Credentials card, claims evidence source, frame thumbnails and downloads, pop-up keyboard behaviour, report download with no frame pictures, a clip with no sound track (speech model not downloaded), NVIDIA unavailable, all-black clip (stopped before any frame is sent).

Run by hand against a local build, NVIDIA mocked (2026-10-15, sandbox with 2 GB RAM):

| Clip | Length | Result |
| --- | --- | --- |
| Synthetic 20 s clip with a tone (short) | 0:20 | full browser run passes; 4 frames |
| Competitor walkthrough (real) | 2:36 | full browser run passes; 16 frames; pop-up; report |
| Complete walkthrough (real) | 6:37 | full browser run passes; 16 frames |
| Complete walkthrough joined five times, no re-encode | 33:03 | full browser run passes; 16 frames; about 30 s to analyse with NVIDIA mocked |
| Clip with no sound track (synthetic) | 0:20 | "no sound track" shown; speech model not downloaded |
| H.265 (re-encoded from the walkthrough) | 1:00 | blocked with the "came out black" message; 0 frames sent. Chromium in the sandbox cannot decode HEVC |
| All-black clip (synthetic) | 0:05 | blocked; 0 frames sent |

Not tested, and why:

- **Non-English clip:** no non-English recording was available to test with.
- **Repeat runs for consistency:** not done. The model's output may vary between runs.
- **In-browser speech on a real clip:** the sandbox runs out of memory while loading the speech model. Test on a normal machine.
- **Real NVIDIA run:** not done. Each real run sends up to 16 frames to NVIDIA and needs your confirmation for each clip.
- **Real fact-check and web-search results:** the unit tests mock both services. The live keys are not configured here.
- **Other browsers:** only Chromium was used. Safari and Firefox were not tested.
- **Real Content Credentials from a camera or AI tool:** the signed clips are made locally with a test certificate chain. That tests the reading path, not what a real signer produces.

## Known limits

- Vision models sometimes invent text on sparse frames. The OCR prompt forbids commentary and caps output length, but the page still asks you to check frame text against the video.
- Search snippets are short. A claim can come back "unverifiable" even when it is true.
- At most 16 moments are analysed per clip. Change-based picking helps with cuts, but a short event with no visual change can still be missed.
- The browser must be able to decode the file. H.264 MP4 and WebM work in Chromium. H.265/HEVC is not decoded in the Chromium used for testing; the page detects this and says so.
- A timeout from NVIDIA is retried once. A second failure shows an error. Nothing is shown as a result for that step.

## Privacy

- The limits check, Content Credentials check, frame scan and capture, and speech step run in your browser. Nothing from them is uploaded.
- Frames (up to 16 downscaled stills) and the text (transcript and on-screen text) go to NVIDIA NIM when you press "Analyse this clip". Claim queries go to Google Fact Check Tools and, if no match, to SerpAPI.
- Reverse-image search links open the search site only when you click them; you upload the frame yourself.
- Do not use confidential clips with the cloud steps.
