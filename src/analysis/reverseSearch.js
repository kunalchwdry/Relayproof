// Plain links to public reverse-image search pages. No API keys and no calls from this app:
// the user downloads a frame and uploads it on the site. (Those services cannot fetch a local frame themselves.)

export const REVERSE_IMAGE_SEARCHES = [
  { id: 'lens', name: 'Google Lens', url: 'https://lens.google.com/', howTo: 'Upload the downloaded frame on the Lens page.' },
  { id: 'tineye', name: 'TinEye', url: 'https://tineye.com/', howTo: 'Upload the frame to find where else the image appears and when it first appeared.' },
  { id: 'bing', name: 'Bing Visual Search', url: 'https://www.bing.com/visualsearch', howTo: 'Upload the frame to find matching pages.' },
];

// A safe, readable file name for a downloaded frame, e.g. "clip-0-52s.jpg".
export function frameFileName(clipName, timestampSeconds) {
  const base = String(clipName || 'clip')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'clip';
  const seconds = Math.max(0, Math.round(Number(timestampSeconds) || 0));
  return `${base}-${seconds}s.jpg`;
}
