// Turns an .srt / .vtt / plain text file into plain transcript text.
// Drops WEBVTT headers, cue numbers, timing lines, and NOTE blocks; strips inline tags.
export function parseCaptions(raw) {
  return String(raw)
    .split(/\r?\n/)
    .filter(line => line.trim() && !/^WEBVTT/i.test(line) && !/^\d+$/.test(line.trim()) && !/-->/.test(line) && !/^NOTE\b/.test(line))
    .map(line => line.replace(/<[^>]+>/g, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
