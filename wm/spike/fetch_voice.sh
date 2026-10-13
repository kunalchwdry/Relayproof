#!/usr/bin/env bash
# Download the Piper voice used by make_clips.py (about 63 MB, not stored in the project).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/voices"
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium"
mkdir -p "$DIR"
curl -fL -o "$DIR/en_US-lessac-medium.onnx" "$BASE/en_US-lessac-medium.onnx"
curl -fL -o "$DIR/en_US-lessac-medium.onnx.json" "$BASE/en_US-lessac-medium.onnx.json"
echo "voice ready in $DIR"
