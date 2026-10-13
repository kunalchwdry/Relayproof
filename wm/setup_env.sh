#!/usr/bin/env bash
# Create the watermark Python environment from requirements.txt.
# Usage: wm/setup_env.sh [venv_dir]   (default: ~/.cache/wm-venv)
# The venv is kept outside the project and outside workspace snapshots:
# snapshots drop files in large venvs, which breaks them on restore.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VENV="${1:-$HOME/.cache/wm-venv}"
PY="${PYTHON:-python3}"
export TMPDIR="${TMPDIR:-$HOME/.cache/tmp}"; mkdir -p "$TMPDIR"
"$PY" -m venv "$VENV"
"$VENV/bin/python" -m pip install -q --upgrade pip
# CPU wheels first (much smaller); fall back to the default index if unavailable.
"$VENV/bin/python" -m pip install -q torch==2.14.1 torchaudio==2.11.0 \
  --index-url https://download.pytorch.org/whl/cpu \
  || "$VENV/bin/python" -m pip install -q torch==2.14.1 torchaudio==2.11.0
"$VENV/bin/python" -m pip install -q -r "$HERE/requirements.txt"
"$VENV/bin/python" -c "import torch, audioseal, web3, soundfile, imageio_ffmpeg, piper; print('wm env ok')"
