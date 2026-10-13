#!/usr/bin/env python3
"""Render the narrated RelayProof competitor walkthrough as an MP4."""
from __future__ import annotations

import math
import re
import subprocess
import sys
import wave
from pathlib import Path
from typing import Iterable

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "video"
W, H = 1280, 720
FPS = 15
TRANSITION_FRAMES = 7

# Ink / ivory / mint palette: quiet premium media-forensics feel.
BG_TOP = (12, 19, 39)
BG_BOTTOM = (7, 12, 25)
PANEL = (19, 30, 53)
PANEL_HI = (24, 38, 64)
PANEL_DARK = (12, 21, 39)
WHITE = (241, 246, 252)
MUTED = (165, 180, 201)
DIM = (112, 130, 156)
MINT = (89, 232, 190)
BLUE = (139, 164, 255)
AMBER = (255, 197, 100)
CORAL = (255, 126, 133)
LAVENDER = (204, 170, 255)
FONT_REG_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_MONO_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    path = FONT_BOLD_PATH if weight == "bold" else FONT_MONO_PATH if weight == "mono" else FONT_REG_PATH
    key = (path, size)
    if key not in FONT_CACHE:
        FONT_CACHE[key] = ImageFont.truetype(path, size)
    return FONT_CACHE[key]


def make_background() -> Image.Image:
    yy, xx = np.mgrid[0:H, 0:W]
    t = (yy / max(1, H - 1))[..., None]
    top = np.array(BG_TOP, dtype=np.float32)
    bottom = np.array(BG_BOTTOM, dtype=np.float32)
    arr = top * (1 - t) + bottom * t
    glow_a = np.exp(-(((xx - 1100) / 470) ** 2 + ((yy - 75) / 330) ** 2) * 1.7)[..., None]
    glow_b = np.exp(-(((xx - 40) / 460) ** 2 + ((yy - 680) / 260) ** 2) * 2.0)[..., None]
    arr += glow_a * np.array([5, 38, 39], dtype=np.float32)
    arr += glow_b * np.array([20, 10, 34], dtype=np.float32)
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    im = Image.fromarray(arr, "RGB")
    d = ImageDraw.Draw(im)
    # Faint technical grid, intentionally low contrast.
    for x in range(24, W, 48):
        d.line((x, 0, x, H), fill=(16, 25, 44), width=1)
    for y in range(24, H, 48):
        d.line((0, y, W, y), fill=(16, 25, 44), width=1)
    return im


BASE = make_background()


def rounded(d: ImageDraw.ImageDraw, box, radius=18, fill=PANEL, outline=None, width=1):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def shadow_card(im: Image.Image, box, radius=18, fill=PANEL, outline=(46, 63, 88), shadow_alpha=62):
    x1, y1, x2, y2 = map(int, box)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle((x1 + 2, y1 + 7, x2 + 2, y2 + 7), radius=radius, fill=(0, 0, 0, shadow_alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(10))
    im = Image.alpha_composite(im.convert("RGBA"), layer)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=1)
    return im.convert("RGB")


def text_width(d: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont) -> float:
    return d.textlength(text, font=f)


def wrap_lines(d: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    line = ""
    for word in words:
        trial = word if not line else f"{line} {word}"
        if text_width(d, trial, f) <= max_width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def draw_wrapped(d: ImageDraw.ImageDraw, text: str, xy: tuple[int, int], f: ImageFont.FreeTypeFont,
                 fill=WHITE, max_width=500, line_gap=8, max_lines=None) -> int:
    x, y = xy
    lines = wrap_lines(d, text, f, max_width)
    if max_lines is not None:
        lines = lines[:max_lines]
    line_h = f.size + line_gap
    for i, line in enumerate(lines):
        d.text((x, y + i * line_h), line, font=f, fill=fill)
    return y + len(lines) * line_h


def pill(d: ImageDraw.ImageDraw, x: int, y: int, label: str, color=MINT, bg=None, f=None, pad_x=12, pad_y=7):
    f = f or font(16, "bold")
    bg = bg or tuple(max(0, int(c * 0.16)) for c in color)
    w = int(text_width(d, label, f)) + pad_x * 2
    h = f.size + pad_y * 2
    rounded(d, (x, y, x + w, y + h), radius=h // 2, fill=bg, outline=tuple(int(c * 0.55 + 25) for c in color), width=1)
    d.text((x + pad_x, y + pad_y - 1), label, font=f, fill=color)
    return w, h


def header(im: Image.Image, section: str, page: int, total: int, eyebrow: str | None = None):
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((54, 28, 70, 44), radius=5, fill=MINT)
    d.text((82, 24), "RELAYPROOF", font=font(17, "bold"), fill=WHITE)
    d.text((235, 26), "COMPETITOR WALKTHROUGH", font=font(14, "mono"), fill=MUTED)
    if eyebrow:
        sw = text_width(d, eyebrow, font(13, "mono"))
        d.text((W - 56 - sw, 27), eyebrow, font=font(13, "mono"), fill=DIM)
    d.line((55, 58, W - 55, 58), fill=(45, 60, 83), width=1)
    d.text((W - 95, H - 38), f"{page:02d} / {total:02d}", font=font(14, "mono"), fill=DIM)
    d.text((55, H - 38), section.upper(), font=font(13, "mono"), fill=DIM)


def title_block(im: Image.Image, title: str, subtitle: str | None = None, y=85, title_size=40):
    d = ImageDraw.Draw(im)
    bottom = draw_wrapped(d, title, (62, y), font(title_size, "bold"), WHITE, max_width=1110, line_gap=4, max_lines=2)
    if subtitle:
        draw_wrapped(d, subtitle, (64, bottom + 6), font(19), MUTED, max_width=1090, line_gap=5, max_lines=2)


def arrow(d: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], color=MINT, width=3, head=12):
    d.line((start[0], start[1], end[0], end[1]), fill=color, width=width)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    p1 = (end[0] - head * math.cos(angle - math.pi / 6), end[1] - head * math.sin(angle - math.pi / 6))
    p2 = (end[0] - head * math.cos(angle + math.pi / 6), end[1] - head * math.sin(angle + math.pi / 6))
    d.polygon([end, p1, p2], fill=color)


def draw_wave(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, t: float, color=MINT, bars=42):
    gap = 4
    bw = max(2, (w - (bars - 1) * gap) // bars)
    for i in range(bars):
        phase = i * 0.62 + t * 2.0
        amp = 0.17 + 0.73 * abs(math.sin(phase)) * (0.65 + 0.35 * math.sin(i * 0.16 + t) ** 2)
        bh = max(5, int(h * amp))
        xx = x + i * (bw + gap)
        d.rounded_rectangle((xx, y + (h - bh) // 2, xx + bw, y + (h + bh) // 2), radius=max(2, bw // 2), fill=color)


def icon_circle(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int, label: str, color=MINT):
    d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=(20, 38, 59), outline=color, width=2)
    f = font(17, "bold")
    box = d.textbbox((0, 0), label, font=f)
    d.text((cx-(box[2]-box[0])/2, cy-(box[3]-box[1])/2-2), label, font=f, fill=color)


def card_text(d, x, y, title, body, width, accent=MINT, body_size=17, title_size=20, tag=None):
    d.rounded_rectangle((x, y, x + 5, y + 54), radius=2, fill=accent)
    if tag:
        d.text((x + 18, y - 1), tag.upper(), font=font(12, "mono"), fill=accent)
        y += 19
    d.text((x + 18, y), title, font=font(title_size, "bold"), fill=WHITE)
    return draw_wrapped(d, body, (x + 18, y + title_size + 9), font(body_size), MUTED, max_width=width - 36, line_gap=6)


def scene_1(t: float) -> Image.Image:
    im = BASE.copy()
    d = ImageDraw.Draw(im)
    header(im, "The question", 1, 9, "2:36 • NARRATED")
    pill(d, 62, 96, "AUDIO PROVENANCE", MINT, f=font(14, "mono"))
    d.text((62, 157), "Can you trust", font=font(58, "bold"), fill=WHITE)
    d.text((62, 224), "a voice note?", font=font(66, "bold"), fill=WHITE)
    d.text((64, 318), "A calm walkthrough of what RelayProof is,", font=font(23), fill=MUTED)
    d.text((64, 354), "what already exists, and what still needs proof.", font=font(23), fill=MUTED)
    # Floating audio card.
    im = shadow_card(im, (755, 145, 1196, 390), radius=24, fill=(17, 29, 53), outline=(54, 78, 103))
    d = ImageDraw.Draw(im)
    pill(d, 790, 173, "VOICE NOTE", BLUE, f=font(13, "mono"))
    d.text((790, 219), "public_update.ogg", font=font(24, "bold"), fill=WHITE)
    draw_wave(d, 790, 277, 350, 40, t, color=MINT, bars=38)
    d.ellipse((790, 343, 826, 379), fill=MINT)
    d.polygon([(804, 352), (804, 370), (818, 361)], fill=BG_TOP)
    d.text((842, 352), "PROVENANCE IS EVIDENCE — NOT A TRUTH SCORE", font=font(12, "mono"), fill=MUTED)
    # Bottom progress line.
    d.line((62, 500, 1195, 500), fill=(44, 63, 86), width=3)
    d.line((62, 500, int(62 + 60 * min(1, t / 6)), 500), fill=MINT, width=4)
    pill(d, 62, 535, "PRODUCT WALKTHROUGH", LAVENDER, f=font(13, "mono"))
    d.text((62, 590), "Evidence-first. Honest about the gaps.", font=font(22, "bold"), fill=WHITE)
    return im


def scene_2(t: float) -> Image.Image:
    im = BASE.copy()
    header(im, "Reality check", 2, 9, "PROTOTYPE STATUS")
    title_block(im, "What works today — and what is only a demo", "The current build is a polished UI prototype, not a live provenance verifier.", y=88)
    cards = [
        (62, 224, 414, 525, MINT, "LIVE IN THE PROTOTYPE", "Choose and play a local audio file. Calculate a real SHA-256 digest in the browser."),
        (464, 224, 816, 525, AMBER, "SIMULATED", "Publisher receipts and the matched / no record / uncertain / mismatch scenarios are demo fixtures."),
        (866, 224, 1218, 525, CORAL, "NOT BUILT YET", "No live AudioSeal or SynthID check, C2PA signature validation, soft-binding lookup, Opus match, or Monad call."),
    ]
    for x1, y1, x2, y2, color, label, body in cards:
        im = shadow_card(im, (x1, y1, x2, y2), radius=21, fill=PANEL, outline=(50, 67, 91))
        d = ImageDraw.Draw(im)
        pill(d, x1+22, y1+22, label, color, f=font(12, "mono"))
        icon_circle(d, x1+48, y1+102, 24, "✓" if color==MINT else "~" if color==AMBER else "×", color)
        draw_wrapped(d, body, (x1+24, y1+151), font(20, "bold"), WHITE, max_width=x2-x1-48, line_gap=8)
    d = ImageDraw.Draw(im)
    d.text((65, 573), "A selected file does not drive the demo ‘matched’ card.", font=font(19, "bold"), fill=AMBER)
    d.text((65, 609), "Keep sample outcomes visually separate from live file inspection.", font=font(17), fill=MUTED)
    return im


def scene_3(t: float) -> Image.Image:
    im = BASE.copy()
    header(im, "Walkthrough • issue and share", 3, 9, "PROPOSED FLOW")
    title_block(im, "Publisher → share channel → listener", "Conceptual end-to-end path. These signing, embedding, and resolver steps are not implemented in RelayProof.", y=84, title_size=38)
    stages = [
        (45, "01", "PUBLISHER", "Declare what the audio is, who issued it, and when.", MINT),
        (291, "02", "SIGN + MARK", "Sign a provenance record; embed a supported mark or credential.", BLUE),
        (537, "03", "SHARE", "The app may re-encode to OGG / Opus or strip file metadata.", AMBER),
        (783, "04", "LISTENER", "A recipient receives a voice note—often without the original context.", LAVENDER),
    ]
    box_w, box_h, y = 207, 177, 234
    for i, (x, num, title, body, col) in enumerate(stages):
        im = shadow_card(im, (x, y, x+box_w, y+box_h), radius=19, fill=PANEL, outline=(52, 68, 95))
        d = ImageDraw.Draw(im)
        icon_circle(d, x+34, y+38, 20, num, col)
        d.text((x+18, y+75), title, font=font(17, "bold"), fill=col)
        draw_wrapped(d, body, (x+18, y+107), font(15), MUTED, max_width=box_w-36, line_gap=5, max_lines=3)
        if i < len(stages)-1:
            arrow(d, (x+box_w+7, y+87), (x+box_w+34, y+87), MINT if i < 2 else AMBER, width=3, head=9)
    # Registry / manifest destination under the flow.
    d = ImageDraw.Draw(im)
    rounded(d, (348, 463, 911, 557), radius=18, fill=(13, 24, 44), outline=(64, 91, 118), width=2)
    pill(d, 371, 479, "OPTIONAL RESOLUTION SERVICE", BLUE, f=font(12, "mono"))
    d.text((371, 513), "Manifest • issuer key • status / revocation", font=font(19, "bold"), fill=WHITE)
    # Vertical references from mark and listener to the resolver.
    d.line((599, 411, 599, 462), fill=BLUE, width=2)
    arrow(d, (842, 411), (842, 462), LAVENDER, width=2, head=9)
    d.ellipse((int(300+540*min(1, t/14)), 316, int(312+540*min(1, t/14)), 328), fill=MINT)
    d.text((64, 601), "Audio bytes and private editorial data stay off-chain; only a minimal digest/status could be anchored.", font=font(16), fill=MUTED)
    return im


def scene_4(t: float) -> Image.Image:
    im = BASE.copy()
    header(im, "Walkthrough • verify carefully", 4, 9, "EVIDENCE CHAIN")
    title_block(im, "A result is a chain of checks—not a green tick", "A detected mark is only a lookup hint. Verify the record, content binding, and issuer separately.", y=84, title_size=38)
    stages = [
        (60, "AUDIO", "Bytes received", "Hash / decode" , BLUE),
        (292, "READ", "Manifest or mark", "C2PA / watermark", MINT),
        (524, "RESOLVE", "Find the record", "SBR / registry", LAVENDER),
        (756, "VERIFY", "Signature + binding", "Issuer / content", AMBER),
        (988, "REPORT", "State uncertainty", "Matched / unknown", CORAL),
    ]
    box_w, box_h, y = 197, 154, 262
    for i, (x, title, line1, line2, col) in enumerate(stages):
        im = shadow_card(im, (x, y, x+box_w, y+box_h), radius=19, fill=PANEL, outline=(52, 68, 95))
        d = ImageDraw.Draw(im)
        d.ellipse((x+20, y+19, x+40, y+39), fill=col)
        d.text((x+20, y+56), title, font=font(15, "mono"), fill=col)
        draw_wrapped(d, line1, (x+20, y+83), font(18, "bold"), WHITE, max_width=box_w-40, line_gap=5, max_lines=2)
        draw_wrapped(d, line2, (x+20, y+124), font(13, "mono"), MUTED, max_width=box_w-40, line_gap=4, max_lines=1)
        if i < len(stages)-1:
            arrow(d, (x+box_w+4, y+77), (x+box_w+31, y+77), MINT, width=3, head=9)
    d = ImageDraw.Draw(im)
    rounded(d, (69, 462, 617, 552), radius=18, fill=(28, 33, 50), outline=(102, 82, 66), width=1)
    pill(d, 91, 477, "DON’T OVERCLAIM", AMBER, f=font(12, "mono"))
    d.text((91, 513), "Watermark ≠ identity", font=font(20, "bold"), fill=WHITE)
    rounded(d, (641, 462, 1211, 552), radius=18, fill=(28, 33, 50), outline=(102, 82, 66), width=1)
    pill(d, 663, 477, "DON’T OVERCLAIM", CORAL, f=font(12, "mono"))
    d.text((663, 513), "Valid signature ≠ truthful claim", font=font(20, "bold"), fill=WHITE)
    d.text((70, 599), "A missing credential means ‘no evidence found’—not ‘fake’ or ‘human-made.’", font=font(17), fill=MUTED)
    return im


def scene_5(t: float) -> Image.Image:
    im = BASE.copy()
    header(im, "Difference • web upload", 5, 9, "EXISTING PRODUCT")
    title_block(im, "AIWatermark already covers much of the upload flow", "Product-page claims and provider tests are not independent validation.", y=90, title_size=38)
    im = shadow_card(im, (62, 225, 810, 602), radius=24, fill=PANEL, outline=(56, 83, 108))
    d = ImageDraw.Draw(im)
    pill(d, 91, 251, "AIWATERMARK AUDIO", MINT, f=font(13, "mono"))
    d.text((92, 302), "Audio watermark  +  certificate  +  verify", font=font(25, "bold"), fill=WHITE)
    draw_wave(d, 93, 360, 600, 48, t, color=MINT, bars=44)
    bullets = [
        ("Advertises OGG support", MINT),
        ("AudioSeal presence does not identify the owner", AMBER),
        ("Reported Opus results are on music—not proof for speech", CORAL),
    ]
    y = 442
    for label, col in bullets:
        d.ellipse((96, y+6, 107, y+17), fill=col)
        d.text((122, y), label, font=font(17, "bold"), fill=WHITE)
        y += 44
    im = shadow_card(im, (850, 225, 1218, 602), radius=24, fill=(14, 24, 44), outline=(58, 78, 103))
    d = ImageDraw.Draw(im)
    pill(d, 878, 253, "WHAT IT MEANS", BLUE, f=font(12, "mono"))
    draw_wrapped(d, "A ready-made upload / mark / credential experience already exists.", (879, 307), font(23, "bold"), WHITE, max_width=310, line_gap=8)
    draw_wrapped(d, "RelayProof cannot claim ‘watermark + verify’ as its moat.", (879, 435), font(18), MUTED, max_width=310, line_gap=7)
    pill(d, 879, 535, "TEST VOICE NOTES", AMBER, f=font(12, "mono"))
    return im


def scene_6(t: float) -> Image.Image:
    im = BASE.copy()
    header(im, "Difference • browser tools", 6, 9, "AUDIO CREDENTIAL CHECKS")
    title_block(im, "Recipient-side verification exists, too", "The formats and resolver methods are bounded; don’t assume OGG / Opus support.", y=87, title_size=38)
    # Two larger product cards.
    im = shadow_card(im, (62, 222, 620, 590), radius=22, fill=PANEL, outline=(55, 78, 102))
    im = shadow_card(im, (660, 222, 1218, 590), radius=22, fill=PANEL, outline=(55, 78, 102))
    d = ImageDraw.Draw(im)
    pill(d, 88, 247, "CONTENTLENS", LAVENDER, f=font(13, "mono"))
    d.text((89, 296), "Browser extension", font=font(24, "bold"), fill=WHITE)
    draw_wrapped(d, "Claims to recover cloud C2PA manifests for audio through its own soft-binding service.", (89, 345), font(18), MUTED, max_width=492, line_gap=6)
    d.line((89, 431, 586, 431), fill=(48, 66, 89), width=1)
    draw_wrapped(d, "Current listing: video checks the audio component; C2PA-approved soft bindings and full video checks are future work.", (89, 451), font(16), WHITE, max_width=492, line_gap=5)
    pill(d, 89, 540, "NO OPUS RESULT FOUND", AMBER, f=font(11, "mono"))
    pill(d, 686, 247, "DIGIMARC C2PA EXTENSION", BLUE, f=font(13, "mono"))
    d.text((687, 296), "C2PA in MP3 / WAV", font=font(24, "bold"), fill=WHITE)
    draw_wrapped(d, "Manual browser checks plus optional recovery from supported Digimarc, Adobe Trustmark, and Signpost marks via SBR services.", (687, 345), font(17), MUTED, max_width=492, line_gap=5)
    d.line((687, 446, 1185, 446), fill=(48, 66, 89), width=1)
    draw_wrapped(d, "Shows signer and trust status; recovered-manifest checks can call external resolvers.", (687, 466), font(16), WHITE, max_width=492, line_gap=5)
    pill(d, 687, 540, "NO OGG / OPUS LISTED", AMBER, f=font(11, "mono"))
    d.text((64, 616), "Related: C2PA Inspector’s documented file list omits audio; Provenance Lens focuses on supported OpenAI short-audio signals.", font=font(14), fill=DIM)
    return im


def scene_7(t: float) -> Image.Image:
    im = BASE.copy()
    header(im, "Difference • other prior art", 7, 9, "THE BROAD IDEA IS BUSY")
    title_block(im, "More ingredients already exist", "RelayProof needs a tested, user-validated gap—not a longer feature list.", y=89, title_size=38)
    cards = [
        (62, 222, 414, 496, MINT, "REDOSAN", "Eight documented WAV watermark methods + DID tools. C2PA commands are documented for JPEG / PNG."),
        (464, 222, 816, 496, BLUE, "LOCAL VERIFIERS", "provcheck and AudioTrust cover real local C2PA and audio-signal checks; maturity and support differ."),
        (866, 222, 1218, 496, LAVENDER, "PIPELINE + RESEARCH", "AWS SENTINEL describes mark → manifest → recovery. A public benchmark measures soft-bindings and false matches."),
    ]
    for x1,y1,x2,y2,color,label,body in cards:
        im = shadow_card(im, (x1,y1,x2,y2), radius=20, fill=PANEL, outline=(52,70,93))
        d = ImageDraw.Draw(im)
        pill(d, x1+22, y1+22, label, color, f=font(12,"mono"))
        draw_wrapped(d, body, (x1+23, y1+83), font(17,"bold"), WHITE, max_width=x2-x1-46, line_gap=7)
    d = ImageDraw.Draw(im)
    rounded(d, (62, 526, 1218, 602), radius=18, fill=(27, 25, 42), outline=(94, 73, 113), width=1)
    pill(d, 85, 545, "STRATEGIC READ", AMBER, f=font(12, "mono"))
    d.text((300, 547), "Watermark + credential + registry + browser UI is not a novelty claim.", font=font(19, "bold"), fill=WHITE)
    d.text((65, 626), "Open benchmark: held-out negatives and calibrated false-match rates; results are not independently reproduced here.", font=font(13), fill=DIM)
    return im


def scene_8(t: float) -> Image.Image:
    im = BASE.copy()
    header(im, "The testable hypothesis", 8, 9, "MEASURE, DON’T ASSUME")
    title_block(im, "The only useful ‘difference’ must survive a real share", "Run one clearly labeled public-information clip through the actual target channel.", y=87, title_size=38)
    # Transform pipeline.
    steps = [
        (64, "SOURCE", "AI-voiced clip", MINT),
        (345, "TRANSFORM", "Exact OGG / Opus", AMBER),
        (626, "RECEIVE", "Voice note copy", BLUE),
        (907, "VERIFY", "Recover + bind", LAVENDER),
    ]
    y, bw, bh = 224, 225, 112
    for i,(x,label,body,col) in enumerate(steps):
        rounded(d:=ImageDraw.Draw(im), (x,y,x+bw,y+bh), radius=18, fill=PANEL, outline=(53,73,97), width=1)
        pill(d, x+17, y+14, label, col, f=font(11,"mono"))
        d.text((x+17, y+55), body, font=font(18,"bold"), fill=WHITE)
        if i < 3:
            arrow(d, (x+bw+6,y+57), (x+bw+46,y+57), MINT, width=3, head=10)
    d = ImageDraw.Draw(im)
    # Measurement metrics.
    d.text((66, 367), "MEASURE", font=font(13,"mono"), fill=DIM)
    metrics = [("recovery rate",MINT),("false positives",CORAL),("false negatives",AMBER),("content binding",BLUE)]
    x=65
    for label,col in metrics:
        w,_=pill(d,x,394,label.upper(),col,f=font(12,"mono"),pad_x=12,pad_y=8)
        x+=w+12
    # Four safe result classes.
    d.text((66, 464), "REPORT EVIDENCE, NOT ‘REAL / FAKE’", font=font(13,"mono"), fill=DIM)
    outcomes=[("MATCHED","checks agree",MINT),("NO RECORD","no conclusion",BLUE),("UNCERTAIN","signals conflict",AMBER),("MISMATCH","binding fails",CORAL)]
    x=65
    for label,body,col in outcomes:
        rounded(d,(x,490,x+270,574),radius=16,fill=(17,27,48),outline=(49,66,89),width=1)
        d.text((x+15,505),label,font=font(13,"mono"),fill=col)
        d.text((x+15,535),body,font=font(16,"bold"),fill=WHITE)
        x+=285
    d.text((65, 612), "No credential ≠ fake. A signed claim ≠ proof that the announcement is true.", font=font(17,"bold"), fill=AMBER)
    return im


def scene_9(t: float) -> Image.Image:
    im = BASE.copy()
    header(im, "What to do next", 9, 9, "DECISION / ROADMAP")
    title_block(im, "Build the evidence path before adding more chain", "A short, practical next sequence.", y=88, title_size=40)
    steps = [
        ("01", "Separate fixtures", "Make demo scenarios unmistakably separate from real local file inspection.", MINT),
        ("02", "Prove one Opus path", "Verify signature + resolver + content binding; publish failures and false-match rates.", BLUE),
        ("03", "Validate the workflow", "Ask a newsroom / public-information publisher whether issuer status solves a real problem.", LAVENDER),
        ("04", "Then decide on Monad", "Use it only if a shared auditable status layer beats existing resolver / registry options.", AMBER),
    ]
    y=214
    for num,head,body,col in steps:
        icon_circle(ImageDraw.Draw(im), 94, y+27, 22, num, col)
        d=ImageDraw.Draw(im)
        d.text((135,y+2),head,font=font(22,"bold"),fill=WHITE)
        draw_wrapped(d,body,(135,y+37),font(15),MUTED,max_width=690,line_gap=4,max_lines=2)
        y+=99
    im=shadow_card(im,(894,214,1218,578),radius=24,fill=(16,28,49),outline=(68,88,113))
    d=ImageDraw.Draw(im)
    pill(d,922,239,"TODAY",AMBER,f=font(13,"mono"))
    d.text((922,294),"UI",font=font(70,"bold"),fill=WHITE)
    d.text((922,374),"PROTOTYPE",font=font(28,"bold"),fill=MINT)
    draw_wrapped(d,"Not a live verifier. No live watermark, C2PA, resolver, or Monad checks yet.",(922,432),font(17),MUTED,max_width=248,line_gap=7)
    d.line((64, 625, 1217, 625), fill=(46, 63, 85), width=1)
    d.text((65, 642), "RelayProof • evidence-first provenance walkthrough • Oct 2026", font=font(13,"mono"), fill=DIM)
    return im


SCENES = [scene_1, scene_2, scene_3, scene_4, scene_5, scene_6, scene_7, scene_8, scene_9]
NARRATION_SCENES = [
    "Can you trust an AI-voiced announcement once it has been shared as a voice note?",
    "RelayProof is a prototype for a careful answer, not a deepfake detector. Today it can play a selected file and calculate its local SHA-256, but the receipt and matched scenario are demo data. It does not yet detect AudioSeal or SynthID, verify C2PA signatures, resolve a watermark, compare a re-encoded copy, or call Monad.",
    "The product idea has three roles. A publisher signs a claim about an audio file. A provenance mark or embedded credential can help a recipient find that claim after sharing.",
    "Then the recipient checks the signature, content binding, issuer status, and any transformation evidence. Keep each check separate: a watermark can point to a record; it cannot prove who made the audio or whether the announcement is true.",
    "Existing products already cover parts of this journey. AIWatermark advertises audio certificates and OGG support, with provider-reported tests that do not establish speech performance.",
    "ContentLens claims browser-based audio soft-binding recovery. Digimarc’s extension documents C2PA checks for MP3 and WAV, plus selected watermark-to-manifest recovery.",
    "RedoSan documents several WAV watermark methods and DID tools, but its C2PA commands are for images. Other projects provide local detectors, C2PA verification, or research benchmarks. So the broad combination of watermark, credentials, registry, or blockchain is not new.",
    "The possible test is narrower: take a clearly labeled public-information voice clip, send it through the exact OGG or Opus transformation used by its sharing app, and measure recovery, false matches, and failures. A useful result must distinguish matched evidence, no credential found, uncertain, and mismatch. No credential does not mean fake; a valid signature does not prove the claim is truthful.",
    "Next: separate demo fixtures from real checks, test one end-to-end Opus path, and ask a newsroom or publisher whether the issuer-status workflow solves a real need. Only then decide if Monad adds anything. Today RelayProof is still a UI prototype—not a live verifier.",
]


def ffmpeg_exe() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def run_ffmpeg(args: list[str], *, capture=False):
    return subprocess.run([ffmpeg_exe(), "-hide_banner", "-loglevel", "error", *args], check=True,
                          capture_output=capture, text=capture)


def audio_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as wf:
        return wf.getnframes() / wf.getframerate()


def make_srt(total_frames: int, scene_frames: list[int], out_path: Path):
    """Create optional readable subtitles, paced by narration text length per scene."""
    def stamp(seconds: float) -> str:
        ms = int(round(seconds * 1000))
        h, rem = divmod(ms, 3_600_000)
        m, rem = divmod(rem, 60_000)
        s, ms = divmod(rem, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    cues: list[str] = []
    cursor = 0
    cue_id = 1
    for scene_text, nf in zip(NARRATION_SCENES, scene_frames):
        # Speech generator naturally pauses at sentence boundaries; subtitle groups follow that pacing.
        sentences = re.split(r"(?<=[.!?])\s+", scene_text.strip())
        parts: list[str] = []
        for sentence in sentences:
            words = sentence.split()
            line = ""
            lines: list[str] = []
            for word in words:
                candidate = word if not line else line + " " + word
                if len(candidate) <= 76 or not line:
                    line = candidate
                else:
                    lines.append(line)
                    line = word
            if line:
                lines.append(line)
            # Two SRT lines max per cue; long sentences become a small sequence of cues.
            for i in range(0, len(lines), 2):
                parts.append("\n".join(lines[i:i+2]))
        lengths = [max(1, len(p.replace("\n", " "))) for p in parts]
        scene_start = cursor / FPS
        scene_end = (cursor + nf) / FPS
        span = scene_end - scene_start
        subtotal = sum(lengths) or 1
        offset = 0.0
        for part, nchar in zip(parts, lengths):
            dur = span * nchar / subtotal
            start = scene_start + offset
            end = start + dur
            cues.append(f"{cue_id}\n{stamp(start)} --> {stamp(end)}\n{part}\n")
            cue_id += 1
            offset += dur
        cursor += nf
    out_path.write_text("\n".join(cues), encoding="utf-8")


def build_video() -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    p1 = OUT / "vo_part_01.mp3"
    p2 = OUT / "vo_part_02.mp3"
    if not p1.exists() or not p2.exists():
        raise FileNotFoundError("Expected narration clips vo_part_01.mp3 and vo_part_02.mp3 in video/.")
    voice_wav = OUT / "relayproof_voiceover.wav"
    run_ffmpeg(["-y", "-i", str(p1), "-i", str(p2), "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[outa]",
                "-map", "[outa]", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(voice_wav)])
    duration = audio_duration(voice_wav)
    total_frames = int(round(duration * FPS))
    weights = [len(s) for s in NARRATION_SCENES]
    total_weight = sum(weights)
    # timeline_frames are each slide's intended visible duration. For xfade overlap,
    # each outgoing clip needs extra frames; the overlap then subtracts back to the audio length.
    timeline_frames: list[int] = []
    accumulated = 0
    for weight in weights[:-1]:
        accumulated += weight
        timeline_frames.append(int(round(total_frames * accumulated / total_weight)) - sum(timeline_frames))
    timeline_frames.append(total_frames - sum(timeline_frames))
    if min(timeline_frames) <= TRANSITION_FRAMES * 2:
        raise ValueError("Scene too short for configured transition.")
    clip_frames = [nf + TRANSITION_FRAMES for nf in timeline_frames[:-1]] + [timeline_frames[-1]]

    # Standalone block diagram exported from the same art direction.
    diagram = scene_3(6.0)
    diagram.save(OUT / "relayproof_block_diagram.png", optimize=True)

    video_path = OUT / "relayproof_competitor_walkthrough.mp4"
    cmd = [ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0",
           "-i", str(voice_wav), "-map", "0:v:0", "-map", "1:a:0",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", str(video_path)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdin is not None

    def render(scene_idx: int, frame_idx: int) -> Image.Image:
        return SCENES[scene_idx](frame_idx / FPS)

    try:
        for i, nf in enumerate(clip_frames):
            if i == 0:
                normal_start = 0
            else:
                # The first transition frames of this scene were already blended into the previous scene.
                normal_start = TRANSITION_FRAMES
            normal_end = nf if i == len(clip_frames)-1 else nf - TRANSITION_FRAMES
            for fidx in range(normal_start, normal_end):
                frame = render(i, fidx).convert("RGB")
                proc.stdin.write(np.asarray(frame, dtype=np.uint8).tobytes())
            if i < len(clip_frames)-1:
                for j in range(TRANSITION_FRAMES):
                    old_frame = render(i, nf - TRANSITION_FRAMES + j).convert("RGB")
                    new_frame = render(i+1, j).convert("RGB")
                    alpha = (j + 1) / TRANSITION_FRAMES
                    blended = Image.blend(old_frame, new_frame, alpha)
                    proc.stdin.write(np.asarray(blended, dtype=np.uint8).tobytes())
    except BrokenPipeError:
        stderr = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
        raise RuntimeError(f"FFmpeg stopped while receiving video frames: {stderr}")
    finally:
        proc.stdin.close()
    stderr = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    code = proc.wait()
    if code != 0:
        raise RuntimeError(f"FFmpeg failed ({code}): {stderr}")

    make_srt(total_frames, timeline_frames, OUT / "relayproof_walkthrough.srt")
    # Storyboard notes keep capability statements and uncertainty boundaries with the asset.
    (OUT / "storyboard.md").write_text(
        "# RelayProof competitor walkthrough\n\n"
        "Narrated explainer video, 16:9, 1280×720. It is a designed walkthrough with diagrams—not a live screen recording.\n\n"
        "1. The question: a voice note and provenance.\n"
        "2. Prototype reality: local playback/SHA-256; demo receipts and simulated results; live verification not built.\n"
        "3. Proposed publisher-to-recipient block diagram; explicitly marked conceptual.\n"
        "4. Evidence chain and safe interpretation: watermark is not identity; signature is not truth.\n"
        "5. AIWatermark: advertised OGG/certificate flow; provider tests do not establish speech performance.\n"
        "6. ContentLens and Digimarc: browser C2PA/audio recovery with format and resolver limits.\n"
        "7. RedoSan, local verifiers, AWS architecture, and the soft-binding benchmark.\n"
        "8. Testable voice-note/OGG/Opus hypothesis and four careful outcomes.\n"
        "9. Practical next steps; add Monad only if it provides a demonstrated benefit.\n\n"
        "The voiceover and slide copy distinguish project/vendor claims from independently established facts. The video does not certify any product or hackathon entry.\n",
        encoding="utf-8",
    )
    print(f"Created: {video_path} ({duration:.2f}s, {total_frames} frames @ {FPS}fps)")
    print(f"Created: {OUT / 'relayproof_block_diagram.png'}")
    print(f"Created: {OUT / 'relayproof_walkthrough.srt'}")
    return video_path


if __name__ == "__main__":
    try:
        build_video()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
