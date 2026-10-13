"""AudioSeal robustness spike for RelayProof.

For each watermarked speech clip:
  1. embed a random 16-bit payload with AudioSeal (16-bit generator),
  2. apply a transform (Opus / AAC / MP3 re-encode, resample, gain, trim, noise),
  3. decode back to 16 kHz WAV and run AudioSeal detection,
  4. record detection probability, bit accuracy, and exact-payload match.

Unmarked clips are run through detection against every payload as negative
controls, to measure false positives at the chosen thresholds.

Scope: 6 marked + 6 unmarked synthetic speech clips, one model, one payload per
clip. This is a small measurement, not a benchmark.
"""
import argparse
import csv
import json
import os
import random
import subprocess
import tempfile
import zlib

import imageio_ffmpeg
import soundfile as sf
import torch
from audioseal import AudioSeal

HERE = os.path.dirname(os.path.abspath(__file__))
CLIPS = os.path.join(HERE, "clips")
RESULTS = os.path.join(HERE, "results")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
SR = 16000
MESSAGE_THRESHOLD = 0.5       # AudioSeal per-bit threshold
DETECT_PROB_THRESHOLD = 0.5   # minimum detection probability to count as "detected"
NOISE_SNR_DB = 20.0
DEFAULT_ALPHA = 2.0  # AudioSeal watermark strength; 1.0 fails 20 dB noise (see alpha_sweep.py)

# Codec and processing transforms: name -> (ffmpeg encode args, container suffix)
CODECS = {
    "opus_64k": (["-c:a", "libopus", "-b:a", "64k"], ".opus"),
    "opus_32k": (["-c:a", "libopus", "-b:a", "32k"], ".opus"),
    "opus_16k": (["-c:a", "libopus", "-b:a", "16k"], ".opus"),
    "aac_64k": (["-c:a", "aac", "-b:a", "64k"], ".m4a"),
    "aac_32k": (["-c:a", "aac", "-b:a", "32k"], ".m4a"),
    "mp3_64k": (["-c:a", "libmp3lame", "-b:a", "64k"], ".mp3"),
}
# Non-codec edits: name -> ffmpeg args applied directly to the WAV
EDITS = {
    "resample_22k": ["-ar", "22050"],
    "resample_8k": ["-ar", "8000"],
    "gain_minus6db": ["-af", "volume=-6dB"],
    "trim_first_1s": ["-ss", "1.0"],          # drop the first second
    "trim_to_4s": ["-t", "4.0"],              # keep only the first 4 seconds
}
TRANSFORM_NAMES = ["none", *CODECS.keys(), *EDITS.keys(), "noise_20db"]


def ffmpeg(*args):
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", *args], check=True)


def apply_transform(name, wm_wav, workdir):
    """Return the path to a 16 kHz mono WAV after the transform."""
    out = os.path.join(workdir, f"{name}.wav")
    if name == "none":
        return wm_wav
    if name in CODECS:
        args, suffix = CODECS[name]
        encoded = os.path.join(workdir, f"{name}{suffix}")
        ffmpeg("-i", wm_wav, *args, encoded)          # encode
        ffmpeg("-i", encoded, "-ac", "1", "-ar", "16000", out)  # decode back to 16 kHz
        return out
    if name in EDITS:
        ffmpeg("-i", wm_wav, *EDITS[name], "-ac", "1", "-ar", "16000", out)
        return out
    raise ValueError(name)


def load(path):
    data, sr = sf.read(path, dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    assert sr == SR, (path, sr)
    return torch.tensor(data).reshape(1, 1, -1)


def add_noise(wav, snr_db, seed):
    g = torch.Generator().manual_seed(seed)
    power = wav.pow(2).mean()
    noise = torch.randn(wav.shape, generator=g)
    noise = noise * torch.sqrt(power / (10 ** (snr_db / 10)) / noise.pow(2).mean())
    return wav + noise


def snr_db(clean, noisy):
    noise = noisy - clean
    return 10 * torch.log10(clean.pow(2).mean() / noise.pow(2).mean()).item()


def detect(det, wav):
    prob, bits = det.detect_watermark(wav, sample_rate=SR, message_threshold=MESSAGE_THRESHOLD)
    return float(prob.reshape(-1)[0]), [int(x) for x in bits.reshape(-1).tolist()[:16]]


def payload_bits(payload):
    return [(payload >> (15 - i)) & 1 for i in range(16)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--alpha", type=float, default=DEFAULT_ALPHA)
    alpha = ap.parse_args().alpha
    os.makedirs(RESULTS, exist_ok=True)
    gen = AudioSeal.load_generator("audioseal_wm_16bits")
    det = AudioSeal.load_detector("audioseal_detector_16bits")
    manifest = json.load(open(os.path.join(CLIPS, "manifest.json")))
    marked = [m for m in manifest if m["kind"] == "marked"]
    unmarked = [m for m in manifest if m["kind"] == "unmarked"]

    rng = random.Random(20261013)
    payloads = {m["file"]: rng.randrange(0, 65536) for m in marked}

    rows, fp_rows, payload_log = [], [], {}
    workroot = tempfile.mkdtemp(prefix="rp-spike-")

    for m in marked:
        payload = payloads[m["file"]]
        payload_log[m["file"]] = payload
        clean = load(os.path.join(CLIPS, m["file"]))
        bits = torch.tensor([payload_bits(payload)], dtype=torch.int32)
        with torch.no_grad():
            wm = gen(clean, sample_rate=SR, message=bits, alpha=alpha)
        quality_snr = snr_db(clean, wm)

        clip_dir = os.path.join(workroot, m["file"].replace(".wav", ""))
        os.makedirs(clip_dir, exist_ok=True)
        wm_wav = os.path.join(clip_dir, "watermarked.wav")
        sf.write(wm_wav, wm.reshape(-1).numpy(), SR, subtype="PCM_16")
        if m["file"] == marked[0]["file"]:
            sf.write(os.path.join(RESULTS, "example_watermarked_marked_01.wav"), wm.reshape(-1).numpy(), SR, subtype="PCM_16")

        for name in TRANSFORM_NAMES:
            if name == "noise_20db":
                noisy = add_noise(wm, NOISE_SNR_DB, seed=zlib.crc32(m["file"].encode()))
                path = os.path.join(clip_dir, "noise_20db.wav")
                sf.write(path, noisy.reshape(-1).numpy(), SR, subtype="PCM_16")
            else:
                path = apply_transform(name, wm_wav, clip_dir)
            prob, got = detect(det, load(path))
            matches = sum(int(g == e) for g, e in zip(got, payload_bits(payload)))
            rows.append({
                "clip": m["file"],
                "transform": name,
                "detect_prob": round(prob, 4),
                "bit_matches_of_16": matches,
                "exact_payload_match": matches == 16,
                "detected": bool(prob >= DETECT_PROB_THRESHOLD and matches == 16),
                "watermark_snr_db": round(quality_snr, 2),
            })
            print(m["file"], name, round(prob, 3), matches, flush=True)

    # False-positive controls: unmarked clips, checked against every payload used.
    for u in unmarked:
        prob, got = detect(det, load(os.path.join(CLIPS, u["file"])))
        best = max(sum(int(g == e) for g, e in zip(got, payload_bits(p))) for p in payloads.values())
        fp_rows.append({
            "clip": u["file"],
            "detect_prob": round(prob, 4),
            "best_bit_matches_vs_any_payload": best,
            "false_positive": bool(prob >= DETECT_PROB_THRESHOLD and best == 16),
        })
        print("UNMARKED", u["file"], round(prob, 3), best, flush=True)

    tag = f"alpha{alpha:.1f}"
    for fname, data in ((f"robustness_{tag}.csv", rows), (f"false_positives_{tag}.csv", fp_rows)):
        with open(os.path.join(RESULTS, fname), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(data[0].keys()))
            w.writeheader()
            w.writerows(data)
    with open(os.path.join(RESULTS, "payloads.json"), "w") as f:
        json.dump(payload_log, f, indent=2)
    print("WROTE", RESULTS, flush=True)


if __name__ == "__main__":
    main()
