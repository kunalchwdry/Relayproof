#!/usr/bin/env bash
# Makes a 20-second test clip for the browser test: a test pattern that changes at 10 s, and a tone (no speech).
# Usage: scripts/make-test-clip.sh [out.mp4] [--no-audio]
# Uses ffmpeg from PATH, or set FFMPEG=/path/to/ffmpeg.
set -euo pipefail
OUT="${1:-/tmp/relayproof-test-clip.mp4}"
FF="${FFMPEG:-ffmpeg}"
INPUTS=(-f lavfi -i "testsrc=duration=10:size=640x360:rate=10" -f lavfi -i "smptebars=duration=10:size=640x360:rate=10")
OUTPUT=(-filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" -c:v libx264 -pix_fmt yuv420p)
if [[ "${2:-}" == "--no-audio" ]]; then
  OUTPUT+=(-an)
else
  INPUTS+=(-f lavfi -i "sine=frequency=440:duration=20")
  OUTPUT+=(-map 2:a -c:a aac -shortest)
fi
"$FF" -y -loglevel error "${INPUTS[@]}" "${OUTPUT[@]}" "$OUT"
echo "wrote $OUT"
