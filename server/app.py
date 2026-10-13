"""Optional self-hosted audio/video services for RelayProof.

Run only on a machine you control. Uploaded media is written to a temporary
file for decoding and removed after the request. The first transcription may
fetch Whisper model weights into the local cache. Fingerprinting/comparison
uses local Chromaprint/pyacoustid only; it does not query AcoustID's web API.
"""

from __future__ import annotations

import json
import math
import os
import re
import secrets
import shutil
import tempfile
import threading
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .sbr_contract import sbr_adapter_status

MAX_UPLOAD_BYTES = 500 * 1024 * 1024
MAX_FINGERPRINT_SECONDS = 120
MAX_OCR_FRAMES = 24
MAX_OCR_FRAME_BYTES = 3 * 1024 * 1024
MAX_OCR_TOTAL_BYTES = 24 * MAX_OCR_FRAME_BYTES
TESSERACT_PATH = os.getenv('TESSERACT_CMD', 'tesseract')
ALLOWED_SUFFIXES = {
    ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".mpeg", ".mpg",
    ".opus", ".ogg", ".oga", ".m4a", ".mp3", ".wav", ".aac", ".flac", ".aiff", ".aif",
}
MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
FPCALC_PATH = os.getenv("FPCALC", "fpcalc")

app = FastAPI(title="RelayProof local media tools", version="0.3.0")
RELAYPROOF_EXTENSION_ID = os.getenv("RELAYPROOF_EXTENSION_ID", "").strip()
if re.fullmatch(r"[a-p]{32}", RELAYPROOF_EXTENSION_ID):
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[f"chrome-extension://{RELAYPROOF_EXTENSION_ID}"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization"],
        max_age=600,
    )

# --- Local-request guard -----------------------------------------------------
# CORS only stops browsers from *reading* cross-origin responses. It does not
# stop a hostile page from sending a simple multipart POST to 127.0.0.1, and it
# does not stop DNS rebinding (a hostname that resolves to loopback). The guard
# below rejects those requests before any route runs:
#   * Host must be a loopback name (or one listed in RELAYPROOF_ALLOWED_HOSTS).
#   * If an Origin header is present it must be the configured extension origin
#     or an entry in RELAYPROOF_ALLOWED_ORIGINS. Requests without Origin come from
#     non-browser clients or from the Vite dev proxy, which strips Origin.
# Optional bearer token: when RELAYPROOF_API_TOKEN is set, every /api/* request
# (except CORS preflight) must send "Authorization: Bearer <token>". This stops
# other local processes and unrelated browser profiles. Without it, only the
# Host/Origin rules apply. See THREAT_MODEL.md (T10-T12).
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "[::1]"})


def _csv_env(name: str) -> set[str]:
    return {item.strip() for item in os.getenv(name, "").split(",") if item.strip()}


def _allowed_hosts() -> set[str]:
    return set(LOOPBACK_HOSTS) | {host.lower() for host in _csv_env("RELAYPROOF_ALLOWED_HOSTS")}


def _allowed_origins() -> set[str]:
    origins = _csv_env("RELAYPROOF_ALLOWED_ORIGINS")
    extension_id = os.getenv("RELAYPROOF_EXTENSION_ID", "").strip()
    if re.fullmatch(r"[a-p]{32}", extension_id):
        origins.add(f"chrome-extension://{extension_id}")
    return origins


def _required_api_token() -> str:
    return os.getenv("RELAYPROOF_API_TOKEN", "").strip()


def _host_without_port(host_header: str) -> str:
    host = host_header.strip().lower()
    if host.startswith("["):  # IPv6 literal, e.g. [::1]:8000
        end = host.find("]")
        return host[: end + 1] if end != -1 else host
    if host.count(":") == 1:  # hostname:port
        return host.split(":", 1)[0]
    return host


@app.middleware("http")
async def local_request_guard(request: Request, call_next):
    host = _host_without_port(request.headers.get("host", ""))
    if host not in _allowed_hosts():
        return JSONResponse(
            {"detail": "Host header is not allowed for this local RelayProof service."},
            status_code=403,
        )
    origin = request.headers.get("origin")
    if origin is not None and origin not in _allowed_origins():
        return JSONResponse(
            {"detail": "Origin is not allowed for this local RelayProof service."},
            status_code=403,
        )
    expected_token = _required_api_token()
    # CORS preflights (OPTIONS) carry no credentials; the real request still must.
    if expected_token and request.method != "OPTIONS" and request.url.path.startswith("/api/"):
        supplied = request.headers.get("authorization", "")
        if not secrets.compare_digest(supplied.encode("utf-8"), f"Bearer {expected_token}".encode("utf-8")):
            return JSONResponse(
                {"detail": "Missing or invalid RelayProof API token."},
                status_code=401,
                headers={"WWW-Authenticate": "Bearer"},
            )
    return await call_next(request)


_model: Any | None = None
_model_lock = threading.Lock()


def _load_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                try:
                    from faster_whisper import WhisperModel
                except ImportError as exc:
                    raise RuntimeError(
                        "faster-whisper is not installed. Run: pip install -r server/requirements.txt"
                    ) from exc
                _model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)
    return _model


def _chromaprint_state() -> tuple[bool, str]:
    try:
        import acoustid
    except ImportError:
        return False, "Install pyacoustid and the native Chromaprint library."
    if not getattr(acoustid, "have_chromaprint", False):
        return False, "Chromaprint's native library is unavailable; install the Chromaprint library/tools."
    if not shutil.which(FPCALC_PATH) and not getattr(acoustid, "have_audioread", False):
        return False, "Install fpcalc or an audioread decoder (FFmpeg recommended)."
    return True, ""


def _video_ocr_state() -> tuple[bool, str]:
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        return False, "Install pytesseract and the native Tesseract OCR engine."
    if not shutil.which(TESSERACT_PATH) and not Path(TESSERACT_PATH).is_file():
        return False, "The native Tesseract OCR engine was not found; install it or set TESSERACT_CMD."
    return True, ""


def _ocr_frame_images(images: list[bytes], timestamps: list[float]) -> dict[str, Any]:
    import pytesseract
    from PIL import Image, ImageOps

    pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH
    Image.MAX_IMAGE_PIXELS = 20_000_000
    results = []
    for index, (raw, timestamp) in enumerate(zip(images, timestamps), start=1):
        try:
            with Image.open(BytesIO(raw)) as source:
                if source.width * source.height > 20_000_000:
                    raise ValueError("Frame dimensions exceed the 20-megapixel processing limit.")
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.thumbnail((1600, 1600))
            data = pytesseract.image_to_data(
                image,
                lang="eng",
                config="--psm 6",
                output_type=pytesseract.Output.DICT,
                timeout=15,
            )
            words = []
            confidences = []
            for token, raw_confidence in zip(data.get("text", []), data.get("conf", [])):
                token = token.strip()
                try:
                    confidence = float(raw_confidence)
                except (TypeError, ValueError):
                    continue
                if token and confidence >= 20:
                    words.append(token)
                    confidences.append(confidence)
            results.append({
                "index": index,
                "timestampSeconds": round(float(timestamp), 3),
                "text": " ".join(words),
                "meanOcrConfidence": round(sum(confidences) / len(confidences), 1) if confidences else None,
            })
        except Exception as exc:
            results.append({
                "index": index,
                "timestampSeconds": round(float(timestamp), 3),
                "text": "",
                "meanOcrConfidence": None,
                "error": str(exc)[:180],
            })
    return {
        "frames": results,
        "sampleCount": len(results),
        "notice": "English OCR from sampled frames only. It can miss or misread text, especially small, stylized, animated, low-contrast, or non-English text. Human frame review is still required.",
    }


def _fingerprint(path: str) -> dict[str, Any]:
    import acoustid

    available, message = _chromaprint_state()
    if not available:
        raise RuntimeError(message)
    try:
        duration, encoded = acoustid.fingerprint_file(path, maxlength=MAX_FINGERPRINT_SECONDS)
    except Exception as exc:
        raise RuntimeError(f"Chromaprint could not decode/fingerprint this file: {exc}") from exc
    if isinstance(encoded, bytes):
        encoded = encoded.decode("ascii")
    duration_seconds = min(float(duration), MAX_FINGERPRINT_SECONDS)
    if duration_seconds <= 0:
        raise RuntimeError("Chromaprint returned a non-positive audio duration.")
    return {
        "algorithm": "Chromaprint",
        "fingerprint": str(encoded),
        "durationSeconds": round(duration_seconds, 3),
        "fingerprintedSecondsMax": MAX_FINGERPRINT_SECONDS,
        "comparison": "candidate similarity only; no pass threshold is configured",
    }


def _compare_fingerprint(path: str, reference_fingerprint: str, reference_duration: float) -> dict[str, Any]:
    import acoustid

    available, message = _chromaprint_state()
    if not available:
        raise RuntimeError(message)
    current = _fingerprint(path)
    try:
        score = float(acoustid.compare_fingerprints(
            (current["durationSeconds"], current["fingerprint"].encode("ascii")),
            (float(reference_duration), reference_fingerprint.encode("ascii")),
        ))
    except Exception as exc:
        raise RuntimeError(f"Chromaprint comparison failed: {exc}") from exc
    return {
        "algorithm": "Chromaprint",
        "similarity": round(score, 4),
        "currentDurationSeconds": current["durationSeconds"],
        "referenceDurationSeconds": round(float(reference_duration), 3),
        "interpretation": "Uncalibrated candidate score only. Do not treat this as provenance verification or an identity/truth claim.",
    }


def _transcribe(path: str) -> dict[str, Any]:
    model = _load_model()
    segments_iter, info = model.transcribe(
        path,
        task="transcribe",
        beam_size=3,
        vad_filter=True,
        word_timestamps=False,
    )
    segments = []
    full_text = []
    for segment in segments_iter:
        text = segment.text.strip()
        if text:
            segments.append({
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": text,
            })
            full_text.append(text)
    return {
        "text": " ".join(full_text),
        "language": getattr(info, "language", None),
        "languageProbability": round(float(getattr(info, "language_probability", 0.0)), 4),
        "segments": segments,
        "model": MODEL_NAME,
        "transcriptionOnly": True,
        "notice": "Speech recognition can mishear names, numbers, tickers, and legal disclaimers. Review and correct this transcript before relying on it.",
    }


async def _write_temp_upload(file: UploadFile) -> tuple[str, int]:
    filename = Path(file.filename or "media").name
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail="Unsupported media extension. Upload a common audio or video file.")
    temp_path = None
    total = 0
    try:
        with tempfile.NamedTemporaryFile(prefix="relayproof-", suffix=suffix, delete=False) as temp:
            temp_path = temp.name
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Media must be 500 MB or smaller.")
                temp.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="Uploaded media is empty.")
        return temp_path, total
    except Exception:
        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass
        raise


def _clean_temp(path: str | None) -> None:
    if path:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


@app.get("/api/health")
def health():
    chromaprint_available, chromaprint_message = _chromaprint_state()
    frame_ocr_available, frame_ocr_message = _video_ocr_state()
    sbr_status = sbr_adapter_status()
    return {
        "ok": True,
        "service": "local-media-tools",
        "transcriptionModel": MODEL_NAME,
        "model": MODEL_NAME,
        "modelLoaded": _model is not None,
        "device": DEVICE,
        "chromaprintAvailable": chromaprint_available,
        "chromaprintMessage": chromaprint_message,
        "frameOcrAvailable": frame_ocr_available,
        "frameOcrMessage": frame_ocr_message,
        "sbrAvailable": sbr_status["available"],
        "sbrState": sbr_status["state"],
        "sbrMessage": sbr_status["message"],
    }


@app.get("/api/sbr/health")
def sbr_health():
    """Expose explicit readiness; never imply recovery when no API adapter exists."""
    return sbr_adapter_status()


@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)):
    temp_path = None
    try:
        temp_path, _ = await _write_temp_upload(file)
        try:
            return await run_in_threadpool(_transcribe, temp_path)
        except Exception as exc:
            message = str(exc)
            if "faster-whisper is not installed" in message:
                raise HTTPException(status_code=503, detail=message) from exc
            raise HTTPException(status_code=422, detail=f"Could not transcribe this media: {message[:280]}") from exc
    finally:
        await file.close()
        _clean_temp(temp_path)


@app.post("/api/fingerprint")
async def fingerprint(file: UploadFile = File(...)):
    temp_path = None
    try:
        temp_path, _ = await _write_temp_upload(file)
        try:
            return await run_in_threadpool(_fingerprint, temp_path)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=str(exc)[:320]) from exc
    finally:
        await file.close()
        _clean_temp(temp_path)


@app.post("/api/fingerprint/compare")
async def compare_fingerprint(
    file: UploadFile = File(...),
    reference_fingerprint: str = Form(...),
    reference_duration: float = Form(...),
):
    if not reference_fingerprint or len(reference_fingerprint) > 100_000:
        raise HTTPException(status_code=400, detail="Credential fingerprint is missing or too large.")
    if not re.fullmatch(r"[A-Za-z0-9+/_=-]+", reference_fingerprint):
        raise HTTPException(status_code=400, detail="Credential fingerprint contains invalid characters.")
    if not math.isfinite(reference_duration) or reference_duration <= 0 or reference_duration > MAX_FINGERPRINT_SECONDS + 5:
        raise HTTPException(status_code=400, detail="Reference fingerprint duration must be between 0 and 125 seconds.")
    temp_path = None
    try:
        temp_path, _ = await _write_temp_upload(file)
        try:
            return await run_in_threadpool(_compare_fingerprint, temp_path, reference_fingerprint, reference_duration)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=str(exc)[:320]) from exc
    finally:
        await file.close()
        _clean_temp(temp_path)


@app.post("/api/ocr/frames")
async def ocr_video_frames(
    frames: list[UploadFile] = File(...),
    timestamps: str = Form(...),
):
    available, message = _video_ocr_state()
    if not available:
        raise HTTPException(status_code=503, detail=message)
    if not frames or len(frames) > MAX_OCR_FRAMES:
        raise HTTPException(status_code=400, detail=f"Submit between 1 and {MAX_OCR_FRAMES} sampled frames.")
    try:
        parsed_timestamps = json.loads(timestamps)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Frame timestamps must be a JSON array.") from exc
    if not isinstance(parsed_timestamps, list) or len(parsed_timestamps) != len(frames):
        raise HTTPException(status_code=400, detail="Provide one timestamp for every submitted frame.")
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > 86_400 for value in parsed_timestamps):
        raise HTTPException(status_code=400, detail="Frame timestamps must be finite seconds within a 24-hour video.")

    images = []
    total_bytes = 0
    try:
        for frame in frames:
            raw = await frame.read(MAX_OCR_FRAME_BYTES + 1)
            total_bytes += len(raw)
            if not raw:
                raise HTTPException(status_code=400, detail="A sampled frame was empty.")
            if len(raw) > MAX_OCR_FRAME_BYTES or total_bytes > MAX_OCR_TOTAL_BYTES:
                raise HTTPException(status_code=413, detail="Each frame must be 3 MB or smaller and total frames 72 MB or smaller.")
            images.append(raw)
        return await run_in_threadpool(_ocr_frame_images, images, parsed_timestamps)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not OCR these sampled frames: {str(exc)[:240]}") from exc
    finally:
        for frame in frames:
            await frame.close()
