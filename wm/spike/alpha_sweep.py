"""Strength sweep for AudioSeal 16-bit: does a larger alpha survive white noise,
and what does it cost in audio quality and false positives?

alpha scales the embedded watermark (default 1.0 in the spike).
For each alpha: embed into the 6 marked clips, measure embedding SNR, then add
white noise at several SNRs and decode. Unmarked clips give the false-positive side.

Output: results/alpha_sweep.csv (one row per alpha x noise level).
"""
import csv
import os
import random
import zlib

import soundfile as sf
import torch

from spike import CLIPS, RESULTS, SR, add_noise, detect, load, payload_bits, snr_db
from audioseal import AudioSeal
import json

ALPHAS = [1.0, 1.5, 2.0, 3.0]
NOISE_SNRS = [None, 30.0, 25.0, 20.0, 15.0]  # None = clean


def main():
    gen = AudioSeal.load_generator("audioseal_wm_16bits")
    det = AudioSeal.load_detector("audioseal_detector_16bits")
    manifest = json.load(open(os.path.join(CLIPS, "manifest.json")))
    marked = [m for m in manifest if m["kind"] == "marked"]
    unmarked = [m for m in manifest if m["kind"] == "unmarked"]
    # Same payload assignment as spike.py, so results are comparable.
    rng = random.Random(20261013)
    payloads = {m["file"]: rng.randrange(0, 65536) for m in marked}

    rows = []
    for alpha in ALPHAS:
        wms = {}
        quality = {}
        for m in marked:
            clean = load(os.path.join(CLIPS, m["file"]))
            bits = torch.tensor([payload_bits(payloads[m["file"]])], dtype=torch.int32)
            with torch.no_grad():
                wm = gen(clean, sample_rate=SR, message=bits, alpha=alpha)
            wms[m["file"]] = wm
            quality[m["file"]] = snr_db(clean, wm)
        mean_quality = sum(quality.values()) / len(quality)

        for noise_snr in NOISE_SNRS:
            probs, exact, bitsum = [], 0, 0
            for m in marked:
                wm = wms[m["file"]]
                if noise_snr is None:
                    x = wm
                else:
                    x = add_noise(wm, noise_snr, seed=zlib.crc32(m["file"].encode()))
                prob, got = detect(det, x)
                want = payload_bits(payloads[m["file"]])
                matches = sum(int(g == w) for g, w in zip(got, want))
                probs.append(prob)
                bitsum += matches
                exact += matches == 16
            rows.append({
                "alpha": alpha,
                "embed_snr_db_mean": round(mean_quality, 2),
                "noise_snr_db": "clean" if noise_snr is None else noise_snr,
                "marked_detected_prob_ge_0.5": sum(p >= 0.5 for p in probs),
                "marked_exact_16_of_6": exact,
                "marked_mean_bits": round(bitsum / len(marked), 2),
                "marked_mean_prob": round(sum(probs) / len(probs), 3),
            })
            print(rows[-1], flush=True)

        # False positives at this alpha: unmarked clips against all payloads.
        fp = 0
        max_prob = 0.0
        for u in unmarked:
            prob, _ = detect(det, load(os.path.join(CLIPS, u["file"])))
            max_prob = max(max_prob, prob)
            fp += prob >= 0.5
        rows.append({
            "alpha": alpha, "embed_snr_db_mean": round(mean_quality, 2),
            "noise_snr_db": "unmarked_controls",
            "marked_detected_prob_ge_0.5": fp, "marked_exact_16_of_6": "",
            "marked_mean_bits": "", "marked_mean_prob": round(max_prob, 4),
        })
        print("controls", alpha, fp, round(max_prob, 4), flush=True)

    out = os.path.join(RESULTS, "alpha_sweep.csv")
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print("WROTE", out)


if __name__ == "__main__":
    main()
