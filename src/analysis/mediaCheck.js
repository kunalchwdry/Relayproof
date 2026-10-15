// Checks a clip before analysis, in the browser, without decoding it:
// - whether an MP4 / MOV file has a sound track (it looks for a sound 'hdlr' box in the container);
// - plain-language messages for each kind of failure.

const MP4_EXTENSION = /\.(mp4|m4v|mov)$/i;
const MP4_TYPE = /^video\/(mp4|quicktime|x-m4v)$/i;

// Looks for a handler box ('hdlr') whose handler type is 'soun' (sound) or 'vide' (video) in MP4/MOV bytes.
// Returns 'present', 'absent', or 'unknown' (no track boxes found, for example a non-MP4 file).
export function mp4AudioTrack(bytes) {
  const tag = [0x68, 0x64, 0x6c, 0x72]; // 'hdlr'
  let sawVideo = false;
  for (let i = 0; i + 16 <= bytes.length; i += 1) {
    if (bytes[i] !== tag[0] || bytes[i + 1] !== tag[1] || bytes[i + 2] !== tag[2] || bytes[i + 3] !== tag[3]) continue;
    const handler = String.fromCharCode(bytes[i + 12], bytes[i + 13], bytes[i + 14], bytes[i + 15]);
    if (handler === 'soun') return 'present';
    if (handler === 'vide') sawVideo = true;
  }
  if (sawVideo) return 'absent';
  return 'unknown';
}

// Reads the file in overlapping slices so a large file never has to fit in memory at once.
export async function detectAudioTrack(file, { chunkBytes = 8 * 1024 * 1024 } = {}) {
  const isMp4 = MP4_EXTENSION.test(file?.name || '') || MP4_TYPE.test(file?.type || '');
  if (!isMp4) return 'unknown';
  let sawVideo = false;
  for (let start = 0; start < file.size; start += chunkBytes) {
    const slice = new Uint8Array(await file.slice(start, Math.min(file.size, start + chunkBytes + 16)).arrayBuffer());
    const result = mp4AudioTrack(slice);
    if (result === 'present') return 'present';
    if (result === 'absent') sawVideo = true;
  }
  return sawVideo ? 'absent' : 'unknown';
}

export const ANALYSIS_LIMITS = {
  maxVideoMb: 500,
  maxClipMinutes: 60,
  speechMinutes: 40,
  longSpeechHintMinutes: 10,
};

// Turns an error from the analysis routes into one plain sentence. Returns null when the user cancelled.
export function describeAnalysisError(error) {
  if (error?.name === 'AbortError') return null;
  switch (error?.status) {
    case 503:
      return 'The AI analysis service is not available. NVIDIA NIM may not be set up on the server, or it is down. Nothing was checked. Try again later.';
    case 429:
      return 'The NVIDIA service is limiting requests right now. Wait a minute, then try again.';
    case 504:
      return 'NVIDIA did not answer in time. Try again, or analyse a shorter clip.';
    case 413:
      return 'The text is too long for one check. Paste a shorter transcript.';
    default:
      return error instanceof Error && error.message ? error.message : 'Analysis failed. Try again.';
  }
}

// True when a speech-to-text failure looks like running out of memory (common on laptops with long clips).
export function isOutOfMemory(error) {
  return error instanceof RangeError || /memory|allocation|out of/i.test(String(error?.message || ''));
}

export function speechFailureMessage(error) {
  if (isOutOfMemory(error)) {
    return 'The browser ran out of memory while transcribing the speech. Paste a transcript instead, or analyse a shorter clip. If the page reloaded, that was the cause.';
  }
  return `Speech-to-text could not run: ${error instanceof Error ? error.message : 'unknown error'}. Paste a transcript to check the words.`;
}

// A browser that cannot decode a codec (H.265/HEVC is common) still gives a duration, but every frame comes out black.
// If the scanned thumbnails are all near-black, the picture was not decoded (or the clip really is black).
export const BLANK_PICTURE_LUMA = 8;

export function pictureLooksBlank(meanLumas) {
  if (!meanLumas || meanLumas.length === 0) return false;
  return Math.max(...meanLumas) < BLANK_PICTURE_LUMA;
}

export const BLANK_PICTURE_MESSAGE =
  'Every frame of this clip came out black, so there was nothing to check, and nothing was sent. The browser probably cannot decode this video (H.265/HEVC is often not supported). Convert it to MP4 with H.264 video and try again.';
