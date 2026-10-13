# RelayProof Media Check — Chrome extension prototype

This Manifest V3 prototype checks a RelayProof sidecar against either a selected local media file or a user-triggered recording of the active browser tab (for example, audio currently playing in YouTube).

## What it can and cannot check

- **Local audio/video file:** the extension verifies the sidecar signature, computes SHA-256 locally for files up to 128 MB, and reports an exact-byte match if it is exact. If bytes differ and the signed sidecar contains a Chromaprint reference, it can ask the local backend for an audio similarity score.
- **Current-tab audio:** after a click, Chrome records 15, 30, or 60 seconds of the active tab's audio and compares that new recording with the sidecar's Chromaprint reference. It does not download the YouTube source file or read its original bytes; an exact SHA-256 verdict is therefore not possible for a tab capture.
- A Chromaprint score is an **uncalibrated candidate similarity**, not proof of same publisher, authenticity, AI generation, or truth. It is aimed at near-identical audio; short speech clips may not match reliably.
- For video, exact hashing covers the whole selected video file; Chromaprint compares only its audio. It does not compare video frames.

Tab capture starts only after the user clicks **Start tab capture**. Recording runs in a background service worker and an offscreen document, so it continues if the popup is closed; reopen the popup to see the result. Start the YouTube clip before clicking. Captured audio is held in memory and sent only to the RelayProof backend you run on your own computer; it is not uploaded to a cloud matching service or saved by the extension.

## Load unpacked in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select this `extension/` folder.
3. Copy the extension ID shown on the extension card.
4. Install the local Python requirements and native Chromaprint dependencies described in `../LIVE_VERIFIER.md`.
5. Set the exact extension ID in the backend environment, then start the local service. For Linux/macOS:

   ```bash
   export RELAYPROOF_EXTENSION_ID='paste-the-32-character-extension-id-here'
   python3 -m uvicorn server.app:app --host 127.0.0.1 --port 8000
   ```

   On Windows PowerShell, set `$env:RELAYPROOF_EXTENSION_ID='paste-the-32-character-extension-id-here'` before running Uvicorn.

The backend accepts browser requests only from the configured extension ID (`RELAYPROOF_EXTENSION_ID`) and only with a loopback `Host` header. CORS alone was not enough, so this check runs before every route. The extension sends requests to `http://127.0.0.1:8000`; the backend must be running on that port. Don't point the extension at the shared preview for private audio.

## Optional API token

If you set `RELAYPROOF_API_TOKEN` on the backend, every request must carry it:

```bash
export RELAYPROOF_API_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
python3 -m uvicorn server.app:app --host 127.0.0.1 --port 8000
```

Paste the same value into the **Local API token** box in the popup and click **Save**. The popup stores it in `chrome.storage.local` for this browser profile only. Anyone who can read that profile can read the token, so treat it as a local development secret. The Vite dev proxy adds the header on the server side; the token is never placed in the browser bundle.

## Recording and the popup

Tab capture now runs in `background.js` (the service worker) and `offscreen.js` (a hidden recorder document). Closing the popup does not stop a recording. Reopen the popup to see the score. Stop and timeout paths are covered by `npm run test:extension`, which uses a stubbed `chrome` API. A real Chrome run is still required before the capture path is trusted.

## Use it

1. In the RelayProof app, issue a signed sidecar with **Attach an experimental Chromaprint reference** enabled. This needs the local native backend.
2. Open the extension popup and choose that `.relayproof.json` sidecar. The popup verifies its signature before using the embedded reference.
3. Either choose a local audio/video file, or start playback in the active tab and click **Start tab capture**. You can close the popup while it records; reopen it to see the result.
4. Read the result as a candidate score only; there is no pass threshold or authenticity verdict.

This is an unpacked development prototype; it has not been submitted to the Chrome Web Store or externally security-audited.
