#!/usr/bin/env python3
"""Render a narrated, feature-complete RelayProof product walkthrough."""
from __future__ import annotations

import math
import subprocess
import sys
import wave
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "video"
W, H, FPS = 1280, 720, 15
TRANSITION_FRAMES = 7

# Warm spruce / brass palette to match the RelayProof interface.
SPRUCE = (18, 48, 39)
SPRUCE_DARK = (8, 25, 21)
PANEL = (24, 54, 44)
PANEL_DARK = (14, 37, 31)
PANEL_LIGHT = (32, 67, 54)
PAPER = (244, 242, 232)
MUTED = (185, 194, 178)
DIM = (135, 153, 137)
BRASS = (207, 172, 116)
MINT = (145, 190, 157)
BLUE = (131, 177, 181)
CORAL = (223, 133, 115)
LAVENDER = (193, 171, 205)
LINE = (51, 83, 67)
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONTS: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}

NARRATION = [
    "Welcome to RelayProof. This is a complete walkthrough of the current audio and video prototype: how publishers issue signed media records, how recipients verify exact files, what Chromaprint can and cannot tell us, how transcript and video review works, and how to use the Chrome extension with a YouTube tab. The central idea is evidence, not a magic authenticity score. Each result has a narrow meaning. Missing evidence is not proof that a clip is fake.",
    "Start in the Issue workflow. Choose an audio or video file up to one hundred twenty eight megabytes, enter a publisher name and asset title, then make a declaration about its origin. RelayProof computes a SHA two fifty six digest in the browser and signs the claim with a local E C D S A key. You can download the signed sidecar and share it with the original file. An optional Chromaprint checkbox adds a fingerprint reference, but only if the local media service is running. If the file is a video, that fingerprint covers the audio track, not the picture.",
    "In Verify, load the media and its RelayProof sidecar. First, the signature check asks whether the signed fields still match the public key embedded in that sidecar. It does not prove who owns the key. Next, the exact file check compares the file's SHA two fifty six digest with the signed digest. A match means these exact bytes match. Re-encoding normally changes them, so a mismatch is not proof of forgery. Pinning a key is only a local reminder on this device, not an identity certificate. Older RelayProof audio sidecars remain supported.",
    "Chromaprint is an optional candidate-matching aid for near-identical audio. When issuing, RelayProof can sign a compressed fingerprint into the sidecar. Later, a recipient can compare a different file to that reference. The local pyacoustid service returns a similarity score after aligning fingerprints; it does not look up tracks or publishers online. Generation uses at most the first one hundred twenty seconds. There is no calibrated threshold, and a high score does not authenticate a publisher, prove a claim, or detect A I audio. It is especially important to test short speech clips and real re-encodes before relying on a score.",
    "The Review page handles content review separately from provenance. You can play local audio or video, paste a transcript, or import subtitle files. If the self-hosted Whisper service is installed, you can ask it to transcribe the selected media. The text pre-check uses limited English phrase rules, flags selected risk language, and surfaces numeric or date claims for source checking. It does not fetch official records, verify facts, confirm a speaker's registration, inspect every frame, or decide whether a clip complies with SEBI rules. A human reviewer must check context and current primary sources.",
    "For video, the Review page can also sample up to twenty four evenly spaced frames across the clip. The browser scales and captures still images, then sends only those selected stills to your local Tesseract service after you click the scan button. English text is returned with timestamps; clicking a timestamp jumps the video player to that moment. You can edit the OCR text and include it in the phrase scan. This is not full-frame coverage. It can miss brief overlays and misread small, stylized, low-contrast, or non-English text. Inspect the entire video manually.",
    "The Chrome extension is an unpacked Manifest version three prototype. It has two paths. First, select a local audio or video file and a sidecar; the extension can verify the signature and exact hash locally, then request a candidate comparison if the bytes differ. Second, on YouTube or another page, start playback before opening the popup, load a sidecar with a Chromaprint reference, and click Start Tab Capture. Choose fifteen, thirty, or sixty seconds, and keep the popup open. The extension captures the sound currently playing; it does not download the source video. A tab capture is a new recording, so it cannot exact-match the original file.",
    "Here is where media goes. Exact hashing and sidecar signature checks happen in the browser or extension. If you opt into fingerprinting or comparison, the selected media is sent to the self-hosted local backend. Whisper transcription sends the full selected clip to that backend. Video OCR sends only the sampled still images, not the full video. The Chrome extension calls the backend on your own computer, with access restricted to its configured extension identifier. The shared preview backend is offline and is not for private clips. The service needs native Chromaprint and Tesseract components for the related features.",
    "A few important boundaries. RelayProof does not detect whether arbitrary audio is A I generated or fake. It does not establish real-world publisher identity, speaker consent, or claim truth. Chromaprint is not a watermark and does not compare video visuals. The content review is not exhaustive and never returns a SEBI-approved result. C two P A validation, watermark or S B R recovery, and Monad anchoring are still not connected. A valid signature means only that the signed data checks against the included public key. Keep each of those distinctions visible.",
    "To try the complete flow, issue a sidecar for a test audio or video file. If you want a candidate match, enable the optional Chromaprint reference. Install the local Python requirements and native libraries, then start the backend. For Chrome, load the extension folder as unpacked, copy its identifier, and configure that identifier before restarting the backend. Select the sidecar in the extension, then choose a local file or capture a short sample from the active tab. Review every result cautiously. RelayProof is a developing evidence workflow, not an oracle. Evidence first; verdicts never without proof.",
]


def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    path = FONT_BOLD if weight == "bold" else FONT_MONO if weight == "mono" else FONT_REG
    key = (path, size)
    if key not in FONTS:
        FONTS[key] = ImageFont.truetype(path, size)
    return FONTS[key]


def make_background() -> Image.Image:
    yy, xx = np.mgrid[0:H, 0:W]
    mix = (yy / max(1, H - 1))[..., None]
    top = np.array(SPRUCE, dtype=np.float32)
    bottom = np.array(SPRUCE_DARK, dtype=np.float32)
    pixels = top * (1 - mix) + bottom * mix
    glow_a = np.exp(-(((xx - 1110) / 450) ** 2 + ((yy - 75) / 310) ** 2) * 1.8)[..., None]
    glow_b = np.exp(-(((xx - 40) / 460) ** 2 + ((yy - 700) / 250) ** 2) * 2.0)[..., None]
    pixels += glow_a * np.array([34, 29, 12], dtype=np.float32)
    pixels += glow_b * np.array([10, 25, 18], dtype=np.float32)
    im = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(im)
    for x in range(20, W, 64):
        d.line((x, 0, x, H), fill=(17, 42, 34), width=1)
    for y in range(20, H, 64):
        d.line((0, y, W, y), fill=(17, 42, 34), width=1)
    return im


BASE = make_background()


def measure(d: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont) -> float:
    return d.textlength(text, font=f)


def wrap(text: str, f: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    dummy = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    words, lines, line = text.split(), [], ""
    for word in words:
        trial = word if not line else f"{line} {word}"
        if measure(dummy, trial, f) <= max_width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def paragraph(d: ImageDraw.ImageDraw, text: str, xy: tuple[int, int], f: ImageFont.FreeTypeFont,
              fill=MUTED, max_width=500, gap=6, max_lines=None) -> int:
    x, y = xy
    lines = wrap(text, f, max_width)
    if max_lines is not None:
        lines = lines[:max_lines]
    advance = f.size + gap
    for i, line in enumerate(lines):
        d.text((x, y + i * advance), line, font=f, fill=fill)
    return y + len(lines) * advance


def rounded(d: ImageDraw.ImageDraw, box, radius=16, fill=PANEL, outline=LINE, width=1):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def card(im: Image.Image, box, radius=18, fill=PANEL, outline=LINE):
    x1, y1, x2, y2 = map(int, box)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle((x1 + 2, y1 + 7, x2 + 2, y2 + 7), radius=radius, fill=(0, 0, 0, 70))
    im = Image.alpha_composite(im.convert("RGBA"), layer.filter(ImageFilter.GaussianBlur(10))).convert("RGB")
    ImageDraw.Draw(im).rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=1)
    return im


def pill(d: ImageDraw.ImageDraw, x: int, y: int, label: str, color=BRASS, f=None, padx=11, pady=6):
    f = f or font(12, "mono")
    w = int(measure(d, label, f)) + padx * 2
    h = f.size + pady * 2
    bg = tuple(int(c * .16) for c in color)
    outline = tuple(int(c * .55 + 20) for c in color)
    rounded(d, (x, y, x + w, y + h), radius=h // 2, fill=bg, outline=outline)
    d.text((x + padx, y + pady - 1), label, font=f, fill=color)
    return w, h


def draw_arrow(d: ImageDraw.ImageDraw, start, end, color=BRASS, width=3, head=11):
    d.line((start[0], start[1], end[0], end[1]), fill=color, width=width)
    a = math.atan2(end[1] - start[1], end[0] - start[0])
    p1 = (end[0] - head * math.cos(a - math.pi / 6), end[1] - head * math.sin(a - math.pi / 6))
    p2 = (end[0] - head * math.cos(a + math.pi / 6), end[1] - head * math.sin(a + math.pi / 6))
    d.polygon([end, p1, p2], fill=color)


def draw_wave(d: ImageDraw.ImageDraw, x: int, y: int, width: int, height: int, t: float, color=MINT, bars=44):
    gap = 4
    bw = max(2, (width - (bars - 1) * gap) // bars)
    for i in range(bars):
        phase = i * .59 + t * 2.2
        amplitude = .15 + .78 * abs(math.sin(phase)) * (.65 + .35 * math.sin(i * .14 + t) ** 2)
        bh = max(4, int(height * amplitude))
        xx = x + i * (bw + gap)
        d.rounded_rectangle((xx, y + (height - bh) // 2, xx + bw, y + (height + bh) // 2), radius=max(2, bw // 2), fill=color)


def icon_circle(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int, label: str, color=BRASS):
    d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=(24, 52, 42), outline=color, width=2)
    f = font(15, "bold")
    b = d.textbbox((0, 0), label, font=f)
    d.text((cx - (b[2] - b[0]) / 2, cy - (b[3] - b[1]) / 2 - 2), label, font=f, fill=color)


def header(im: Image.Image, section: str, page: int, total: int, badge: str = "PRODUCT WALKTHROUGH"):
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((52, 25, 69, 42), radius=5, fill=BRASS)
    d.text((81, 21), "RELAYPROOF", font=font(16, "bold"), fill=PAPER)
    d.text((224, 23), "COMPLETE FEATURE WALKTHROUGH", font=font(12, "mono"), fill=MUTED)
    w = measure(d, badge, font(11, "mono"))
    d.text((W - 55 - w, 24), badge, font=font(11, "mono"), fill=DIM)
    d.line((54, 56, W - 54, 56), fill=LINE, width=1)
    d.text((55, H - 35), section.upper(), font=font(11, "mono"), fill=DIM)
    d.text((W - 90, H - 35), f"{page:02d} / {total:02d}", font=font(11, "mono"), fill=DIM)


def title(d: ImageDraw.ImageDraw, text: str, x=62, y=83, size=38, max_width=1125, fill=PAPER):
    return paragraph(d, text, (x, y), font(size, "bold"), fill, max_width, gap=4, max_lines=2)


def small_card(im: Image.Image, x: int, y: int, w: int, h: int, label: str, headline: str, body: str, accent=MINT):
    im = card(im, (x, y, x + w, y + h), radius=17)
    d = ImageDraw.Draw(im)
    pill(d, x + 17, y + 16, label, accent, font(10, "mono"), padx=9, pady=5)
    d.text((x + 17, y + 52), headline, font=font(17, "bold"), fill=PAPER)
    paragraph(d, body, (x + 17, y + 82), font(12), MUTED, w - 34, gap=4, max_lines=4)
    return im


def scene_1(t: float) -> Image.Image:
    im = BASE.copy(); header(im, "Start here", 1, 10)
    d = ImageDraw.Draw(im)
    pill(d, 62, 96, "AUDIO + VIDEO PROVENANCE", BRASS, font(12, "mono"))
    d.text((62, 159), "RelayProof", font=font(60, "bold"), fill=PAPER)
    d.text((63, 232), "Complete product walkthrough", font=font(37, "bold"), fill=MINT)
    paragraph(d, "Signed source claims • exact-file checks • local content review • Chrome extension", (65, 300), font(18), MUTED, 560, gap=7)
    # Right-side signal graphic.
    im = card(im, (716, 132, 1209, 475), radius=27, fill=(18, 45, 36), outline=(74, 105, 78))
    d = ImageDraw.Draw(im)
    icon_circle(d, 963, 221, 53, "RP", BRASS)
    d.ellipse((836, 300, 1090, 554), outline=(68, 106, 78), width=2)
    d.ellipse((862, 326, 1064, 528), outline=(54, 92, 68), width=1)
    draw_wave(d, 792, 354, 343, 52, t, MINT, 39)
    pill(d, 792, 430, "ISSUE", MINT, font(10, "mono"))
    pill(d, 893, 430, "VERIFY", BLUE, font(10, "mono"))
    pill(d, 1000, 430, "REVIEW", BRASS, font(10, "mono"))
    paragraph(d, "Evidence, not an oracle.", (64, 534), font(24, "bold"), PAPER, 590, gap=4)
    paragraph(d, "A guided tour of what works, what needs a local service, and what the prototype does not claim.", (64, 574), font(15), MUTED, 620, gap=5)
    return im


def scene_2(t: float) -> Image.Image:
    im = BASE.copy(); header(im, "Feature map", 2, 10)
    d = ImageDraw.Draw(im); title(d, "Four connected workflows", y=84, size=39)
    subtitle = "A sidecar records a publisher claim; local review helps a person inspect the media around it."
    paragraph(d, subtitle, (64, 139), font(16), MUTED, 1070, gap=4)
    items = [
        (62, 210, "01  ISSUE", "Sign the source record", "Whole-file SHA-256 plus a local ECDSA key; export a JSON sidecar.", MINT),
        (660, 210, "02  VERIFY", "Check the exact bytes", "Verify the signature, compare the digest, and optionally pin a key on this device.", BLUE),
        (62, 406, "03  REVIEW", "Inspect audio and video", "Transcribe, import captions, scan limited text rules, and review OCR samples.", BRASS),
        (660, 406, "04  EXTENSION", "Test a selected source", "Choose a local file or capture a short clip from the active browser tab.", LAVENDER),
    ]
    for x, y, label, headline, body, accent in items:
        im = small_card(im, x, y, 558, 166, label, headline, body, accent)
    d = ImageDraw.Draw(im)
    d.text((65, 622), "All automatic findings are bounded; a person still verifies identity, facts, and compliance.", font=font(14), fill=DIM)
    return im


def scene_3(t: float) -> Image.Image:
    im = BASE.copy(); header(im, "01 • Issue", 3, 10)
    d = ImageDraw.Draw(im); title(d, "Issue a signed audio or video record", y=83, size=36)
    paragraph(d, "New media sidecars use the RelayProof media v1 format. Existing audio v1 sidecars still verify.", (64, 132), font(15), MUTED, 1070, gap=4)
    steps = [
        (67, "PICK", "Media ≤ 128 MB", "Choose original audio or video." , MINT),
        (354, "DECLARE", "Publisher + origin", "A self-asserted claim goes in the sidecar.", BLUE),
        (641, "BIND", "SHA-256", "Hash the entire file in the browser.", BRASS),
        (928, "SIGN", "ECDSA P-256", "Sign claim, digest, and optional fingerprint.", LAVENDER),
    ]
    for i, (x, label, h, body, accent) in enumerate(steps):
        im = card(im, (x, 222, x + 235, 374), radius=18)
        d = ImageDraw.Draw(im); pill(d, x + 16, 239, label, accent, font(10, "mono"))
        d.text((x + 16, 281), h, font=font(16, "bold"), fill=PAPER)
        paragraph(d, body, (x + 16, 312), font(11), MUTED, 204, gap=4, max_lines=2)
        if i < 3: draw_arrow(d, (x + 241, 297), (x + 276, 297), BRASS, 3, 10)
    # JSON sidecar mock-up.
    im = card(im, (67, 416, 791, 588), radius=18, fill=PANEL_DARK)
    d = ImageDraw.Draw(im); pill(d, 88, 435, "SIDECAR EXAMPLE", MINT, font(10, "mono"))
    code = [
        ('schema', 'relayproof.media-credential.v1'),
        ('mediaKind', 'video'),
        ('asset.sha256', 'signed exact-file digest'),
        ('proof', 'ECDSA signature'),
    ]
    for i, (key, value) in enumerate(code):
        y = 474 + i * 25
        d.text((91, y), key, font=font(12, "mono"), fill=BRASS)
        d.text((283, y), value, font=font(12, "mono"), fill=PAPER)
    im = card(im, (822, 416, 1213, 588), radius=18, fill=(39, 44, 36), outline=(114, 93, 57))
    d = ImageDraw.Draw(im); pill(d, 844, 435, "OPTIONAL", BRASS, font(10, "mono"))
    paragraph(d, "Chromaprint adds up to 120 seconds of audio reference. Only this opt-in path sends media to the self-hosted backend.", (844, 477), font(14), PAPER, 335, gap=6, max_lines=5)
    return im


def scene_4(t: float) -> Image.Image:
    im = BASE.copy(); header(im, "02 • Verify + archive", 4, 10)
    d = ImageDraw.Draw(im); title(d, "Separate signature, bytes, and key trust", y=83, size=37)
    paragraph(d, "Choose the signed sidecar and the corresponding media file; the exact check happens locally in the browser.", (64, 134), font(15), MUTED, 1090, gap=4)
    # Flow.
    cards = [(64, "SIDE-CAR", "signed JSON", BLUE), (338, "SIGNATURE", "valid / invalid", MINT), (612, "FILE HASH", "exact / differs", BRASS), (886, "KEY PIN", "local reminder", LAVENDER)]
    for i, (x, label, sub, accent) in enumerate(cards):
        im = card(im, (x, 219, x + 224, 315), radius=15)
        d = ImageDraw.Draw(im); pill(d, x + 15, 232, label, accent, font(9, "mono"), padx=8, pady=4)
        d.text((x + 15, 274), sub, font=font(14, "bold"), fill=PAPER)
        if i < len(cards)-1: draw_arrow(d, (x + 229, 266), (x + 265, 266), MINT, 2, 9)
    im = small_card(im, 64, 359, 354, 185, "RESULT A", "Exact match", "Signature valid and selected file digest equals the signed digest. It still does not prove the publisher's real identity or claim truth.", MINT)
    im = small_card(im, 463, 359, 354, 185, "RESULT B", "Bytes differ", "A transcode or edit can change the digest. A mismatch is not proof of fraud; use only an optional candidate aid if a reference exists.", BRASS)
    im = small_card(im, 862, 359, 354, 185, "LOCAL ARCHIVE", "Browser-scoped", "Issued credentials can be reopened or exported. Clearing browser storage can lose the archive or signing key; it is not a backup.", BLUE)
    d = ImageDraw.Draw(im)
    paragraph(d, "A pinned key is remembered on this device only. It is not an external identity check.", (67, 584), font(14, "bold"), MUTED, 1050, gap=4)
    return im


def scene_5(t: float) -> Image.Image:
    im = BASE.copy(); header(im, "03 • Chromaprint", 5, 10)
    d = ImageDraw.Draw(im); title(d, "A candidate audio score—not a provenance verdict", y=82, size=36)
    # Two fingerprint cards + arrows.
    im = card(im, (62, 205, 403, 408), radius=20)
    d = ImageDraw.Draw(im); pill(d, 87, 227, "SIGNED REFERENCE", BLUE, font(10, "mono"))
    draw_wave(d, 88, 286, 282, 41, t, BLUE, 34)
    d.text((88, 352), "attached when issuing", font=font(13), fill=MUTED)
    im = card(im, (877, 205, 1218, 408), radius=20)
    d = ImageDraw.Draw(im); pill(d, 902, 227, "CANDIDATE MEDIA", BRASS, font(10, "mono"))
    draw_wave(d, 903, 286, 282, 41, t + 1.1, BRASS, 34)
    d.text((903, 352), "fingerprinted locally", font=font(13), fill=MUTED)
    d = ImageDraw.Draw(im); draw_arrow(d, (421, 299), (840, 299), MINT, 4, 15)
    rounded(d, (526, 257, 738, 341), 16, fill=(33, 66, 50), outline=(95, 137, 97), width=2)
    d.text((549, 274), "ALIGN + COMPARE", font=font(13, "mono"), fill=MINT)
    d.text((552, 302), "score 0…1", font=font(16, "bold"), fill=PAPER)
    im = small_card(im, 63, 451, 351, 148, "LOCAL", "No AcoustID lookup", "The extension/app calls only your self-hosted fingerprint endpoint.", MINT)
    im = small_card(im, 464, 451, 351, 148, "LIMIT", "First 120 seconds", "Voice clips, trimming, speed, noise, and short duration can affect matching.", BRASS)
    im = small_card(im, 865, 451, 351, 148, "CAUTION", "No pass threshold", "A high score is not identity, truth, or proof of origin. Calibrate on real samples first.", CORAL)
    return im


def scene_6(t: float) -> Image.Image:
    im = BASE.copy(); header(im, "04 • Content review", 6, 10)
    d = ImageDraw.Draw(im); title(d, "Review spoken words without claiming approval", y=82, size=36)
    # mock review UI on left
    im = card(im, (63, 205, 687, 590), radius=21, fill=(18, 45, 37))
    d = ImageDraw.Draw(im); pill(d, 88, 228, "REVIEW AUDIO / VIDEO", MINT, font(10, "mono"))
    rounded(d, (88, 272, 660, 334), 10, fill=(13, 34, 28), outline=LINE)
    d.text((108, 292), "Select video  •  Preview  •  Transcript", font=font(15, "bold"), fill=PAPER)
    rounded(d, (88, 354, 660, 433), 10, fill=(13, 34, 28), outline=LINE)
    paragraph(d, "Import SRT / VTT • paste words • optional local Whisper", (108, 374), font(14), MUTED, 520, gap=5)
    rounded(d, (88, 453, 660, 550), 10, fill=(44, 43, 31), outline=(106, 91, 57))
    pill(d, 108, 469, "PHRASE PRE-CHECK", BRASS, font(9, "mono"))
    paragraph(d, "English heuristics • flags for review • selected claims surfaced for source checks", (108, 501), font(13), PAPER, 520, gap=4, max_lines=2)
    # right: careful scope list
    im = card(im, (732, 205, 1218, 590), radius=21, fill=PANEL)
    d = ImageDraw.Draw(im); pill(d, 758, 229, "HUMAN REVIEW STILL REQUIRED", CORAL, font(9, "mono"))
    bullets = [
        ("role context is self-declared", BLUE),
        ("source URLs are noted, not fetched", BRASS),
        ("facts and registration are not verified", CORAL),
        ("no SEBI-approved / good-to-go verdict", LAVENDER),
    ]
    y = 293
    for label, accent in bullets:
        d.ellipse((760, y + 3, 771, y + 14), fill=accent)
        paragraph(d, label, (790, y - 2), font(14, "bold"), PAPER, 392, gap=4, max_lines=2)
        y += 61
    paragraph(d, "Review rules vary by publisher, content type, role, context, and publication date.", (758, 536), font(13), MUTED, 421, gap=4, max_lines=3)
    return im


def scene_7(t: float) -> Image.Image:
    im = BASE.copy(); header(im, "05 • Video OCR", 7, 10)
    d = ImageDraw.Draw(im); title(d, "Sample frames. Read on-screen text. Review manually.", y=82, size=35)
    # Timeline of sampled frames
    d.line((108, 256, 1170, 256), fill=(76, 108, 81), width=4)
    times = ["00:00", "00:18", "00:42", "01:06", "01:30", "01:54"]
    for i, label in enumerate(times):
        x = 112 + i * 210
        d.ellipse((x - 8, 248, x + 8, 264), fill=BRASS if i % 2 else MINT)
        d.text((x - 29, 278), label, font=font(11, "mono"), fill=MUTED)
        im = card(im, (x - 54, 148, x + 54, 227), radius=10, fill=(23, 55, 45))
        d = ImageDraw.Draw(im)
        # mock sampled image text lines
        rounded(d, (x - 38, 167, x + 38, 208), 4, fill=(53 + i*2, 77 + i*2, 58 + i*2), outline=(88, 111, 79))
        d.line((x - 27, 184, x + 26, 184), fill=PAPER, width=3)
        d.line((x - 19, 195, x + 18, 195), fill=BRASS, width=2)
    # Pipeline at lower half
    steps = [(91, "BROWSER", "capture up to 24 frames", BLUE), (415, "LOCAL TESSERACT", "English OCR on stills", MINT), (739, "REVIEWER", "edit text + jump to time", BRASS), (1041, "PHRASE SCAN", "limited text rules", CORAL)]
    for i, (x, head, body, accent) in enumerate(steps):
        pill(d, x, 380, head, accent, font(9, "mono"), padx=8, pady=5)
        paragraph(d, body, (x, 414), font(13, "bold"), PAPER, 210, gap=4, max_lines=2)
        if i < len(steps) - 1: draw_arrow(d, (x + 225, 408), (x + 284, 408), BRASS, 2, 9)
    im = card(im, (72, 489, 1207, 591), radius=16, fill=(44, 43, 31), outline=(106, 91, 57))
    d = ImageDraw.Draw(im); pill(d, 95, 505, "LIMITS", BRASS, font(9, "mono"))
    paragraph(d, "Evenly spaced samples can miss brief overlays. English OCR can misread stylized, small, or non-English text. It does not check disclosure duration or every frame.", (95, 540), font(13), PAPER, 1077, gap=4, max_lines=2)
    return im


def scene_8(t: float) -> Image.Image:
    im = BASE.copy(); header(im, "06 • Chrome extension", 8, 10)
    d = ImageDraw.Draw(im); title(d, "Use the verifier from a Chrome popup", y=82, size=37)
    # Extension popup mock
    im = card(im, (65, 177, 490, 613), radius=24, fill=(17, 41, 33), outline=(71, 103, 77))
    d = ImageDraw.Draw(im); pill(d, 89, 201, "RELAYPROOF MEDIA CHECK", MINT, font(9, "mono"))
    rounded(d, (89, 245, 466, 314), 10, fill=(12, 31, 25), outline=LINE)
    d.text((108, 260), "Signed sidecar", font=font(13, "bold"), fill=PAPER)
    d.text((108, 284), "Chromaprint reference attached", font=font(10), fill=MINT)
    rounded(d, (89, 332, 466, 404), 10, fill=(12, 31, 25), outline=LINE)
    d.text((108, 346), "Current tab audio", font=font(13, "bold"), fill=PAPER)
    d.text((108, 371), "15 s     30 s     60 s", font=font(11, "mono"), fill=BRASS)
    rounded(d, (89, 422, 466, 468), 9, fill=(83, 101, 66), outline=(111, 136, 88))
    d.text((185, 436), "START TAB CAPTURE", font=font(11, "bold"), fill=PAPER)
    rounded(d, (89, 487, 466, 567), 10, fill=(30, 61, 43), outline=(68, 117, 76))
    d.text((108, 500), "Candidate similarity", font=font(12, "bold"), fill=PAPER)
    d.text((108, 523), "Uncalibrated score only", font=font(11), fill=MUTED)
    # Two usage paths and caveats
    im = small_card(im, 540, 184, 300, 184, "PATH A", "Local media file", "Exact hash first. Candidate compare only if the sidecar contains a fingerprint.", BLUE)
    im = small_card(im, 874, 184, 342, 184, "PATH B", "Active tab audio", "User-initiated capture of what is playing. This is a new recording, not the YouTube source file.", BRASS)
    im = small_card(im, 540, 402, 676, 191, "SETUP", "Load unpacked extension", "Run the backend locally, copy the extension ID, set RELAYPROOF_EXTENSION_ID, then restart the API.", MINT)
    d = ImageDraw.Draw(im)
    paragraph(d, "Keep the popup open during capture. No source download, no cloud lookup, no arbitrary AI-fake verdict.", (545, 618), font(12, "bold"), CORAL, 667, gap=4, max_lines=2)
    return im


def scene_9(t: float) -> Image.Image:
    im = BASE.copy(); header(im, "07 • Privacy + architecture", 9, 10)
    d = ImageDraw.Draw(im); title(d, "What stays local—and when media is sent", y=82, size=37)
    # Three processing zones.
    zones = [(65, "BROWSER / EXTENSION", "Exact SHA-256 • sidecar signature • video frame sampling", BLUE), (463, "SELF-HOSTED API", "Chromaprint • Whisper • Tesseract OCR", MINT), (861, "NO CLOUD LOOKUP", "No AcoustID query • no automatic upload to RelayProof", BRASS)]
    for x, label, body, accent in zones:
        im = card(im, (x, 211, x + 354, 359), radius=18)
        d = ImageDraw.Draw(im); pill(d, x + 18, 228, label, accent, font(9, "mono"))
        paragraph(d, body, (x + 18, 274), font(15, "bold"), PAPER, 318, gap=5, max_lines=3)
    d = ImageDraw.Draw(im)
    draw_arrow(d, (420, 285), (450, 285), BRASS, 3, 9)
    draw_arrow(d, (817, 285), (847, 285), BRASS, 3, 9)
    im = card(im, (65, 401, 1217, 587), radius=18, fill=(16, 40, 32))
    d = ImageDraw.Draw(im); pill(d, 90, 422, "OPERATION-LEVEL PRIVACY", BRASS, font(10, "mono"))
    rows = [
        ("Exact hash / signature", "in browser; no media upload", MINT),
        ("Fingerprint / compare", "selected media to your local API after opt-in", BLUE),
        ("Whisper transcript", "full media to your local API when clicked", BRASS),
        ("Video OCR", "sampled still images only; not the full clip", LAVENDER),
    ]
    y = 463
    for left, right, accent in rows:
        d.ellipse((94, y + 4, 104, y + 14), fill=accent)
        d.text((119, y), left, font=font(12, "bold"), fill=PAPER)
        d.text((429, y), right, font=font(12), fill=MUTED)
        y += 29
    return im


def scene_10(t: float) -> Image.Image:
    im = BASE.copy(); header(im, "08 • Limits + quick start", 10, 10, "EVIDENCE, NOT AN ORACLE")
    d = ImageDraw.Draw(im); title(d, "Know the boundaries. Then test one real workflow.", y=80, size=35)
    limits = [
        ("NO AI / FAKE DETECTOR", "No reference means no provenance match.", CORAL),
        ("NO IDENTITY / TRUTH CHECK", "A valid signature only checks signed bytes.", BRASS),
        ("NO REGULATORY CLEARANCE", "SEBI text preflight is a narrow human aid.", LAVENDER),
        ("NOT CONNECTED", "C2PA • watermark / SBR • Monad.", BLUE),
    ]
    y = 190
    for label, body, accent in limits:
        icon_circle(d, 89, y + 21, 16, "!", accent)
        d.text((120, y + 1), label, font=font(11, "mono"), fill=accent)
        d.text((120, y + 23), body, font=font(13, "bold"), fill=PAPER)
        y += 76
    im = card(im, (658, 184, 1218, 548), radius=23, fill=(19, 47, 37), outline=(78, 109, 76))
    d = ImageDraw.Draw(im); pill(d, 685, 207, "QUICK START", MINT, font(10, "mono"))
    steps = [
        "1. Issue a signed sidecar for a test media file.",
        "2. Add Chromaprint only if candidate matching is needed.",
        "3. Install local native services and start the backend.",
        "4. Load the extension unpacked; set its ID in the API environment.",
        "5. Capture or select media; review every result cautiously.",
    ]
    y = 259
    for text in steps:
        d.ellipse((688, y + 4, 698, y + 14), fill=MINT)
        paragraph(d, text, (713, y), font(13, "bold"), PAPER, 463, gap=4, max_lines=2)
        y += 53
    d.line((63, 601, 1217, 601), fill=LINE, width=1)
    d.text((64, 622), "RelayProof • local prototype walkthrough • signed evidence, bounded conclusions", font=font(12, "mono"), fill=DIM)
    return im


SCENES = [scene_1, scene_2, scene_3, scene_4, scene_5, scene_6, scene_7, scene_8, scene_9, scene_10]


def ffmpeg_exe() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def run_ffmpeg(args: list[str]) -> None:
    subprocess.run([ffmpeg_exe(), "-hide_banner", "-loglevel", "error", *args], check=True)


def duration_of_wav(path: Path) -> float:
    with wave.open(str(path), "rb") as wf:
        return wf.getnframes() / wf.getframerate()


def srt_stamp(seconds: float) -> str:
    ms_total = max(0, int(round(seconds * 1000)))
    hours, rem = divmod(ms_total, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    seconds_i, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds_i:02d},{millis:03d}"


def write_srt(scene_durations: list[float], path: Path) -> None:
    cues = []
    cue_id = 1
    start_scene = 0.0
    for narration, duration in zip(NARRATION, scene_durations):
        sentences = [part.strip() for part in narration.split(".") if part.strip()]
        weights = [max(1, len(sentence)) for sentence in sentences]
        total = sum(weights) or 1
        offset = 0.0
        for sentence, weight in zip(sentences, weights):
            text = sentence.strip() + "."
            words = text.split()
            lines, current = [], ""
            for word in words:
                trial = word if not current else f"{current} {word}"
                if len(trial) <= 52 or not current:
                    current = trial
                else:
                    lines.append(current); current = word
            if current: lines.append(current)
            groups = ["\n".join(lines[i:i + 2]) for i in range(0, len(lines), 2)] or [text]
            group_weights = [max(1, len(group.replace("\n", " "))) for group in groups]
            group_total = sum(group_weights) or 1
            sentence_duration = duration * weight / total
            group_offset = 0.0
            for group, group_weight in zip(groups, group_weights):
                cue_duration = sentence_duration * group_weight / group_total
                a = start_scene + offset + group_offset
                b = a + cue_duration
                cues.append(f"{cue_id}\n{srt_stamp(a)} --> {srt_stamp(b)}\n{group}\n")
                cue_id += 1
                group_offset += cue_duration
            offset += sentence_duration
        start_scene += duration
    path.write_text("\n".join(cues), encoding="utf-8")


def build() -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    clip_files = [OUT / f"full_vo_{i:02d}.mp3" for i in range(1, 11)]
    missing = [str(path) for path in clip_files if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing narration clips:\n" + "\n".join(missing))
    clip_wavs = []
    durations = []
    for index, clip in enumerate(clip_files, start=1):
        wav = OUT / f"full_vo_{index:02d}.wav"
        run_ffmpeg(["-y", "-i", str(clip), "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(wav)])
        clip_wavs.append(wav)
        durations.append(duration_of_wav(wav))
    voice_wav = OUT / "relayproof_complete_voiceover.wav"
    inputs = []
    for path in clip_wavs:
        inputs.extend(["-i", str(path)])
    graph = "".join(f"[{i}:a]" for i in range(len(clip_wavs))) + f"concat=n={len(clip_wavs)}:v=0:a=1[outa]"
    run_ffmpeg(["-y", *inputs, "-filter_complex", graph, "-map", "[outa]", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(voice_wav)])
    actual_duration = duration_of_wav(voice_wav)
    total_frames = int(round(actual_duration * FPS))
    raw_counts = [int(round(duration * FPS)) for duration in durations]
    # Avoid rounding drift while preserving per-section narration pacing.
    frame_counts = []
    elapsed = 0
    for count in raw_counts[:-1]:
        frame_counts.append(count)
        elapsed += count
    frame_counts.append(total_frames - elapsed)
    if len(frame_counts) != len(SCENES) or any(count < TRANSITION_FRAMES + 10 for count in frame_counts):
        raise RuntimeError("Narration section too short or scene count does not match.")

    video_path = OUT / "relayproof_complete_walkthrough.mp4"
    cmd = [ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0",
           "-i", str(voice_wav), "-map", "0:v:0", "-map", "1:a:0",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", str(video_path)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.stdin is None:
        raise RuntimeError("Could not open FFmpeg frame input.")
    try:
        for scene_index, count in enumerate(frame_counts):
            for frame_index in range(count):
                scene_time = frame_index / FPS
                if scene_index < len(SCENES) - 1 and frame_index >= count - TRANSITION_FRAMES:
                    blend_i = frame_index - (count - TRANSITION_FRAMES)
                    old = SCENES[scene_index](scene_time).convert("RGB")
                    new = SCENES[scene_index + 1](blend_i / FPS).convert("RGB")
                    frame = Image.blend(old, new, (blend_i + 1) / TRANSITION_FRAMES)
                else:
                    frame = SCENES[scene_index](scene_time).convert("RGB")
                proc.stdin.write(np.asarray(frame, dtype=np.uint8).tobytes())
    except BrokenPipeError as exc:
        stderr = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
        raise RuntimeError(f"FFmpeg stopped while rendering frames: {stderr}") from exc
    finally:
        proc.stdin.close()
    stderr = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    return_code = proc.wait()
    if return_code != 0:
        raise RuntimeError(f"FFmpeg failed with code {return_code}: {stderr}")
    write_srt(durations, OUT / "relayproof_complete_walkthrough.srt")
    print(f"Rendered {video_path} · {actual_duration:.1f} seconds · {W}x{H} · {FPS} fps")
    print(f"Captions: {OUT / 'relayproof_complete_walkthrough.srt'}")
    return video_path


if __name__ == "__main__":
    try:
        build()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
