# RelayProof video analysis: one-page guide

## What it does

Open **Analyse video**, choose a clip, and press **Analyse this clip**. The page:

1. Reads the file's Content Credentials (C2PA) in your browser: who signed it, which tool made it, and whether it declares AI generation or editing.
2. Picks up to 16 moments from the clip, mostly where the picture changes, plus even coverage of the rest.
3. Sends those moments to NVIDIA NIM to read on-screen text and flag issues (illegal content, violence, sexual content, scam visuals, and visual problems).
4. Checks the words (transcript, typed text, and on-screen text) for unsafe content, scam patterns, and factual claims.
5. Shows results per moment on a timeline, and raises a pop-up for high-priority findings.

Every result is a lead for a person to check. None of it is a verdict.

## Before you start

| Limit | Value |
| --- | --- |
| File size | 500 MB or less |
| Clip length | 60 minutes or less |
| Formats | MP4, WebM, MOV, MKV in a browser that can decode them. H.264 MP4 and WebM work in the Chromium used for testing. H.265 (HEVC) did not decode there, and other browsers may behave differently. |
| Spoken words in the browser | Clips up to 40 minutes, English only |

## Reading the results

- **Pop-up alerts** appear for: a frame issue of illegal content, violence, sexual content, or scam visuals at medium or high severity; text the safety model flags; a scam-pattern match in the words; and a claim that is contradicted or fails the logic check.
- **Review items** cover weaker signals, such as visual inconsistencies or "possible synthetic artifacts". These never raise a pop-up on their own.
- **Moments** are listed with their time, so you can see where each finding is.
- **Claims** show the verdict and the source. Published fact checks are used first. Web search results are used only when no fact check matches.
- **Export report (JSON)** downloads every finding, time, claim, source, and the provenance result. Frame pictures are left out.

## What it does not check

- **AI-generated or deepfake content:** not checked automatically. No free detector we tested could tell real images from generated ones. A "no credentials" result is not evidence either way.
- **Reverse-image search:** you get download and plain links to Google Lens, TinEye, and Bing Visual Search. You upload the frame yourself. The app calls none of these services.
- **Non-English speech:** the in-browser speech model is English only. Paste a transcript for other languages.

## Common messages and what to do

| Message | What to do |
| --- | --- |
| "This clip has no sound track" | Nothing was missing. There were no spoken words to check. |
| "came out black" | The browser could not decode the picture, which happened with H.265 in testing. Convert to H.264 MP4 and try again. No frames were sent. |
| "The clip is longer than 60 minutes" | Trim the clip. |
| "NVIDIA ... not available" | The service is down or not configured. Try again later. Nothing is shown as a result for that step. |
| "could not read the audio" | Paste a transcript instead. |
| Speech memory error on a long clip | Paste a transcript instead. A shorter clip also helps. |

## Cancel

**Cancel analysis** stops the run at its next step. Nothing from a cancelled run is kept. The speech model and any NVIDIA call already in progress finish in the background, and their results are discarded.

## What leaves your browser

- **Nothing** for the content-credentials check, the frame scan, the capture step, and the in-browser speech step.
- **When you press Analyse this clip:** up to 16 downscaled frames and the text (transcript and on-screen text) go to NVIDIA NIM.
- **For claims:** the claim text goes to Google Fact Check Tools and, if nothing matches, to SerpAPI.
- **Reverse-image search:** only when you click a link yourself.

Do not use confidential clips with the cloud steps.

## Keyboard

- The pop-up opens with focus inside it. Tab and Shift+Tab stay inside. Escape closes it and returns focus to the control that opened it.

For limits, test results, and what has not been verified, see [ANALYSIS.md](ANALYSIS.md).
