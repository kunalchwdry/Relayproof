// Chooses which moments of a clip to send for analysis. Pure functions, so they can be tested without a browser.
//
// Even spacing alone misses short events between samples. So we also look at how much each moment
// differs from the one before it, and keep the biggest changes (cuts, new on-screen content) as well.

// candidates: [{ time, diff }] sorted by time. diff is the change from the previous candidate (0..1).
// count: how many moments to keep. duration: clip length in seconds.
export function chooseSampleTimes(candidates, count, duration) {
  if (!candidates.length || count <= 0) return [];
  const sorted = [...candidates].sort((a, b) => a.time - b.time);
  const step = duration > 0 ? duration / Math.max(1, count - 1) : 0;
  const minGap = Math.max(1, step * 0.5);
  const chosen = [];
  const free = time => !chosen.some(t => Math.abs(t - time) < minGap);

  // 1. The biggest changes first (up to half the slots), so a cut is never blocked by a grid point.
  const byChange = [...sorted].sort((a, b) => b.diff - a.diff);
  for (const candidate of byChange) {
    if (chosen.length >= Math.ceil(count / 2)) break;
    if (candidate.diff < 0.02) break;
    if (free(candidate.time)) chosen.push(candidate.time);
  }

  // 2. Even coverage of the whole clip, around what is already chosen.
  const grid = Math.max(2, count);
  for (let i = 0; i < grid && chosen.length < count; i += 1) {
    const target = (duration * i) / Math.max(1, grid - 1);
    const nearest = sorted.reduce((best, c) => (Math.abs(c.time - target) < Math.abs(best.time - target) ? c : best), sorted[0]);
    if (free(nearest.time)) chosen.push(nearest.time);
  }

  // 3. Fill any remaining slots with the next biggest changes.
  for (const candidate of byChange) {
    if (chosen.length >= count) break;
    if (free(candidate.time)) chosen.push(candidate.time);
  }

  return chosen.sort((a, b) => a - b).slice(0, count);
}

// Mean absolute difference between two equally sized grayscale pixel arrays, scaled to 0..1.
export function frameDifference(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / (a.length * 255);
}
