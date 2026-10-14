# Video analysis: how it works and what it can't do

The "Analyse video" page plays a clip, reads frames, checks the words, and raises pop-up alerts for high-priority findings. Everything it produces is a lead for a human to check. None of it is a verdict on authenticity.

## Pipeline

1. **Frame sampling (browser).** The video is stepped through at up to 16 evenly spaced points. Each frame is downscaled to 960 px and encoded as JPEG (kept under 480 KB). The full video is never uploaded.
2. **Frame analysis (`POST /api/nim/analyze-frames`).** Frames go to a NVIDIA NIM vision model, four at a time. Each frame returns the visible on-screen text and a list of issues with a category and severity.
3. **Text analysis (`POST /api/nim/analyze-text`).** The transcript you paste (or upload as captions) and the on-screen text go through three steps:
   - a content-safety model (`nvidia/nemotron-3.5-content-safety`),
   - a scam-pattern scan (guaranteed returns, urgency, requests to send money),
   - claim extraction, then a live SerpAPI search per claim, then a verdict that may cite only the search snippets, plus a logic check.
4. **Findings (`src/analysis/findings.js`).** Pure rules decide what becomes a pop-up, what becomes a review item, and what goes on the timeline.

## What raises a pop-up

| Source | Pop-up when |
| --- | --- |
| Frame issue | category is illegal content, violence, sexual content, or scam visual, at medium or high severity |
| Text safety | the content-safety model flags the text as unsafe |
| Scam scheme | any scheme flag is found in the text |
| Claim | the verdict is "contradicted", or the logic check finds a problem |

Visual inconsistencies and "possible synthetic artifacts" never raise a pop-up on their own. They appear as review items.

## Deepfake and AI-generated signals: not a verdict

No dedicated deepfake classifier is connected yet. The NVIDIA synthetic-video detector in the catalog returns an internal error for this account, and it has no public documentation. The "Deepfake & AI-generated signals" card lists only the vision model's low-confidence observations. It must not be read as a deepfake result.

## Speech: not yet automatic

NVIDIA's catalog has no speech-to-text model for this key. Until an in-browser model is added, spoken claims are checked only from a transcript you provide. Hugging Face's hosted Whisper returned "no remaining credits", so hosted speech is not used.

## Planned, not built

- In-browser speech-to-text (Whisper via Transformers.js), run on the device.
- In-browser frame classifier for deepfake and AI-generation signals, with its accuracy stated on the page.

Both would download model files from the Hugging Face Hub at first use. No inference credits are needed.

## Privacy

Cloud steps send up to 16 downscaled still frames and the text to NVIDIA NIM, and claim queries to SerpAPI. The page asks for confirmation before the frames are sent. Do not use confidential clips with the cloud steps.

## Known limits

- Vision models sometimes invent text on sparse frames. The OCR prompt forbids commentary and caps output length, but the page still asks you to check frame text against the video.
- Search snippets are short. A claim can come back "unverifiable" even when it is true.
- Frame sampling covers at most 16 points. Short events between samples can be missed.
- The browser must be able to seek and decode the file. Some codecs (for example HEVC in some browsers) may fail.
