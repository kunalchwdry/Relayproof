# Video analysis: how it works and what it can't do

The "Analyse video" page plays a clip, reads frames, checks the words, and raises pop-up alerts for high-priority findings. Everything it produces is a lead for a human to check. None of it is a verdict on authenticity.

## Pipeline

1. **Scan (browser).** The clip is stepped through every few seconds at thumbnail size. The page measures how much each moment changes from the one before.
2. **Choose moments (browser, `src/analysis/sampling.js`).** Up to 16 moments are kept: the biggest changes first (cuts, new on-screen content), then even coverage of the whole clip.
3. **Capture (browser).** Only those moments are captured at full size (960 px, JPEG, under 480 KB). The full video is never uploaded.
4. **Frame analysis (`POST /api/nim/analyze-frames`).** Frames go to a NVIDIA NIM vision model, four at a time. Each frame returns the visible on-screen text and a list of issues with a category and severity. A timeout or overload is retried once.
5. **Speech (browser, optional).** If the transcript box is empty and the "Transcribe the speech in this browser" box is ticked, Whisper tiny runs on the device (about 41 MB the first time, English only). Typed or uploaded captions always win.
6. **Text analysis (`POST /api/nim/analyze-text`).** The transcript and on-screen text go through a content-safety model, a scam-pattern scan, and claim extraction. Each claim gets a live SerpAPI search and a verdict that may cite only the search snippets, plus a logic check.
7. **Findings (`src/analysis/findings.js`).** Pure rules decide what becomes a pop-up, what becomes a review item, and what goes on the timeline.

## What raises a pop-up

| Source | Pop-up when |
| --- | --- |
| Frame issue | category is illegal content, violence, sexual content, or scam visual, at medium or high severity |
| Text safety | the content-safety model flags the text as unsafe |
| Scam scheme | any scheme flag is found in the text |
| Claim | the verdict is "contradicted", or the logic check finds a problem |

Visual inconsistencies and "possible synthetic artifacts" never raise a pop-up on their own. They appear as review items.

## Deepfake and AI-generated content: not checked automatically

No automatic check runs for AI-generated or deepfake content. The card on the page lists only the vision model's low-confidence observations, and it says so.

Why: we tested free models before shipping a browser check, and none could tell real images from generated ones.

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
- **Not checked in a browser here:** the test sandbox's browser ran out of memory while loading the model, even at 41 MB. The page's own speech step is therefore unverified in a browser. The typed-transcript path is verified end to end.
- **Limits:** English only. Hindi and Hinglish will be poor. Clips over 40 minutes are not transcribed. Noisy audio gives errors.

## Known limits

- Vision models sometimes invent text on sparse frames. The OCR prompt forbids commentary and caps output length, but the page still asks you to check frame text against the video.
- Search snippets are short. A claim can come back "unverifiable" even when it is true.
- At most 16 moments are analysed per clip. Change-based picking helps with cuts, but a short event with no visual change can still be missed.
- The browser must be able to seek and decode the file. H.264 MP4 and WebM work in Chromium; some other codecs may fail.
- A timeout from NVIDIA is retried once. A second timeout shows an error, and the rest of the analysis can still complete.

## Privacy

- The scan, frame capture, and speech step run in your browser. Nothing from them is uploaded.
- Frames (up to 16 downscaled stills) and the text (transcript and on-screen text) go to NVIDIA NIM when you press "Analyse this clip". Claim queries go to SerpAPI.
- Do not use confidential clips with the cloud steps.
