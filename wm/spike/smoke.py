import time
import torch
from audioseal import AudioSeal

t = time.time()
gen = AudioSeal.load_generator("audioseal_wm_16bits")
det = AudioSeal.load_detector("audioseal_detector_16bits")
print("loaded in", round(time.time() - t, 1), "s", flush=True)

sr = 16000
wav = 0.1 * torch.sin(2 * torch.pi * 220 * torch.arange(sr * 3) / sr).reshape(1, 1, -1)
msg = torch.randint(0, 2, (1, 16))
wm = gen(wav, sample_rate=sr, message=msg)
prob, bits = det.detect_watermark(wm, sample_rate=sr, message_threshold=0.5)
print("detect prob", prob, flush=True)
print("bits", bits, flush=True)
print("msg ", msg, flush=True)
