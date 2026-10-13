#!/usr/bin/env python3
"""RelayProof watermark issue/verify CLI (prototype, testnet registry only).

issue   Embed a 16-bit AudioSeal ID into speech, write a manifest and receipt,
        and optionally register the manifest digest on RelayProofRegistry.
        Refuses to register an ID that another credential already uses.
verify  Detect the 16-bit ID, look up registrations for it, and compare the
        manifest digest with the on-chain record. Verdicts come from decide().

Limits (state these wherever the output is shown):
  - 16-bit IDs are not unique. Verify reports ambiguity instead of guessing,
    unless the manifest's digest picks exactly one registration.
  - A bit-error tolerance (NEAR_TOLERANCE) lets noisy detections still match a
    manifest. Without a manifest, near matches are only "possible", never a match.
  - Only the watermark links a copy to a registration. Exact-byte matching works
    only for the original WAV. A re-encoded copy relies on the watermark alone.
  - Anyone can register a manifest that claims someone else's watermark ID. Use
    --trusted-issuer to accept only issuers you know. See wm/README.md.
  - manifest.createdAt is issuer-asserted, not proven.
  - Prototype. Not audited. Testnet only.

Usage:
  python relayproof_wm.py issue --input clip.wav --out-dir out/ --title "..." \
      --issuer "Newsroom X" --key-id rp-key-1 \
      [--register --deployment chain/deployments/monadTestnet.json]
  python relayproof_wm.py verify --input suspect.opus --manifest out/manifest.json \
      --deployment chain/deployments/monadTestnet.json [--trusted-issuer 0x...]
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import secrets
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
ARTIFACT = os.path.join(PROJECT, "chain", "artifacts", "contracts",
                        "RelayProofRegistry.sol", "RelayProofRegistry.json")
MANIFEST_SCHEMA = "relayproof.wm-manifest.v2"
MODEL = "audioseal_wm_16bits"
DEFAULT_ALPHA = 2.0          # 1.0 fails 20 dB white noise (see wm/spike/results/alpha_sweep.csv)
SR = 16000
DETECT_PROB_THRESHOLD = 0.5
MESSAGE_THRESHOLD = 0.5
NEAR_TOLERANCE = 2           # max differing bits for a near match
LOG_CHUNK = 100              # Monad testnet rejects eth_getLogs ranges over 100 blocks
STATUS = {0: "unknown", 1: "active", 2: "revoked"}
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


class CliError(SystemExit):
    """Exit with a readable message instead of a traceback."""


# ---------- pure helpers (no torch, no network) ----------

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical(obj):
    """Deterministic JSON for hashing. Strings and ints only (no floats)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def manifest_digest(manifest):
    return hashlib.sha256(canonical(manifest)).hexdigest()


def bits_of(payload):
    return [(payload >> (15 - i)) & 1 for i in range(16)]


def int_of(bits):
    return int("".join(str(int(b)) for b in bits), 2)


def hamming(a, b):
    return bin(a ^ b).count("1")


def decide(prob, detected_id, manifest_id, manifest_digest_hex, exact, near, trusted,
           registry_checked):
    """Pure verdict logic.

    exact: registrations whose watermarkId equals the ID looked up (see cmd_verify).
    near:  registrations within NEAR_TOLERANCE bits of detected_id (no-manifest case only).
    Each registration is a dict with credentialId, issuer, manifestDigest, status.
    Returns (verdict, extra) where extra holds diagnostic fields.
    """
    if prob < DETECT_PROB_THRESHOLD:
        return "no_watermark_detected", {}
    if manifest_id is not None:
        dist = hamming(detected_id, manifest_id)
        if dist > NEAR_TOLERANCE:
            return "watermark_mismatch_with_manifest", {"bitErrors": dist}
    if not registry_checked:
        return "watermark_detected_registry_not_checked", {}

    if manifest_id is not None:
        if not exact:
            return "watermark_not_registered", {}
        chosen = [c for c in exact if c["manifestDigest"] == "0x" + manifest_digest_hex]
        if len(exact) > 1 and len(chosen) != 1:
            return "ambiguous_watermark_id", {"candidates": exact}
        c = chosen[0] if chosen else exact[0]
        extra = {"bitErrors": hamming(detected_id, manifest_id), "candidate": c}
        if c["manifestDigest"] != "0x" + manifest_digest_hex:
            return "manifest_digest_mismatch", extra
        if c["status"] == "revoked":
            return "registered_revoked", extra
        if trusted is not None and c["issuer"].lower() not in trusted:
            return "registered_untrusted_issuer", extra
        if c["status"] != "active":
            return "registered_" + c["status"], extra
        return "registered_active_manifest_match", extra

    # No manifest: only the detected ID is known.
    if exact:
        if len(exact) > 1:
            return "ambiguous_watermark_id", {"candidates": exact}
        c = exact[0]
        if trusted is not None and c["issuer"].lower() not in trusted:
            return "registered_untrusted_issuer", {"candidate": c}
        return "registered_" + c["status"] + "_manifest_not_checked", {"candidate": c}
    if near:
        return "possible_registration_needs_manifest", {"nearCandidates": near}
    return "watermark_not_registered", {}


# ---------- media and model helpers (torch imported lazily) ----------

def ffmpeg_exe():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def to_16k_mono(src, dst):
    subprocess.run([ffmpeg_exe(), "-y", "-loglevel", "error", "-i", src,
                    "-ac", "1", "-ar", str(SR), dst], check=True)
    return dst


def load_models():
    import warnings
    warnings.filterwarnings("ignore")
    from audioseal import AudioSeal
    gen = AudioSeal.load_generator(MODEL)
    det = AudioSeal.load_detector("audioseal_detector_16bits")
    return gen, det


def read_wav(path):
    import soundfile as sf
    import torch
    data, sr = sf.read(path, dtype="float32")
    if sr != SR or data.ndim != 1:
        raise CliError(f"expected 16 kHz mono WAV, got {sr} Hz, {data.ndim}-D audio")
    return torch.tensor(data).reshape(1, 1, -1)


def embed(gen, src_wav, dst_wav, payload, alpha):
    import torch
    import soundfile as sf
    wav = read_wav(src_wav)
    with torch.no_grad():
        out = gen(wav, sample_rate=SR, message=torch.tensor([bits_of(payload)], dtype=torch.int32),
                  alpha=alpha)
    sf.write(dst_wav, out.reshape(-1).numpy(), SR, subtype="PCM_16")


def detect(det, wav_path):
    import torch
    wav = read_wav(wav_path)
    with torch.no_grad():
        prob, bits = det.detect_watermark(wav, sample_rate=SR, message_threshold=MESSAGE_THRESHOLD)
    prob = float(prob.reshape(-1)[0])
    bits = [int(x) for x in bits.reshape(-1).tolist()[:16]]
    return prob, int_of(bits)


# ---------- registry helpers ----------

def load_registry(deployment_path, rpc_url=None):
    from web3 import Web3
    if not os.path.exists(deployment_path):
        raise CliError(f"deployment file not found: {deployment_path}")
    with open(deployment_path) as f:
        dep = json.load(f)
    with open(ARTIFACT) as f:
        abi = json.load(f)["abi"]
    url = rpc_url or dep.get("rpcUrl") or os.environ.get("MONAD_TESTNET_RPC") or "https://testnet-rpc.monad.xyz"
    w3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 30}))
    try:
        chain_id = w3.eth.chain_id
    except Exception as exc:  # network errors vary by provider
        raise CliError(f"cannot reach RPC {url}: {exc}")
    if chain_id != dep["chainId"]:
        raise CliError(f"RPC chain id {chain_id} != deployment chain id {dep['chainId']}")
    contract = w3.eth.contract(address=Web3.to_checksum_address(dep["address"]), abi=abi)
    return w3, contract, dep


def load_key():
    key = os.environ.get("RELAYPROOF_TESTNET_KEY")
    if not key:
        path = os.path.join(os.path.expanduser("~"), ".relayproof-testnet.key")
        if os.path.exists(path):
            key = open(path).read().strip()
    if not key:
        raise CliError("No key. Set RELAYPROOF_TESTNET_KEY or create ~/.relayproof-testnet.key.")
    return key


def get_logs_paged(w3, contract, from_block, watermark_id=None):
    """Registered logs from from_block to latest, paged to respect the RPC range limit."""
    latest = w3.eth.block_number
    filt = {"watermarkId": watermark_id} if watermark_id is not None else None
    logs = []
    for start in range(from_block, latest + 1, LOG_CHUNK):
        end = min(start + LOG_CHUNK - 1, latest)
        logs += list(contract.events.Registered.get_logs(
            from_block=start, to_block=end, argument_filters=filt))
    return logs


def record_of(contract, cid_hex):
    rec = contract.functions.getRecord(bytes.fromhex(cid_hex[2:])).call()
    status = contract.functions.status(bytes.fromhex(cid_hex[2:])).call()
    return {"credentialId": cid_hex, "issuer": rec[0], "manifestDigest": "0x" + rec[1].hex(),
            "status": STATUS.get(status, "unknown")}


def registrations(w3, contract, dep, watermark_id, near_to=None):
    """Exact lookup by watermark ID (indexed event topic), or a full scan for near matches."""
    logs = get_logs_paged(w3, contract, dep.get("blockNumber", 0),
                          None if near_to is not None else watermark_id)
    seen, out = set(), []
    for log in logs:
        wid = log["args"]["watermarkId"]
        if near_to is not None and hamming(wid, near_to) > NEAR_TOLERANCE:
            continue
        if near_to is not None and wid == near_to:
            continue  # exact matches are handled separately
        cid = "0x" + log["args"]["credentialId"].hex()
        if cid in seen:
            continue
        seen.add(cid)
        rec = record_of(contract, cid)
        rec["watermarkId"] = wid
        out.append(rec)
    return out


# ---------- commands ----------

def cmd_issue(args):
    from web3 import Web3
    os.makedirs(args.out_dir, exist_ok=True)
    if not 0 < args.alpha <= 5:
        raise CliError("--alpha must be in (0, 5]")
    w3 = contract = dep = None
    if args.register:
        w3, contract, dep = load_registry(args.deployment, args.rpc)

    if args.payload is not None:
        if not 0 <= args.payload < 65536:
            raise CliError("payload must fit in 16 bits")
        payload = args.payload
    else:
        payload = secrets.randbelow(65536)
    if args.register:
        # Pick an ID no other registration uses, so verifiers never see two credentials for one ID.
        for _ in range(50):
            if not registrations(w3, contract, dep, payload):
                break
            if args.payload is not None:
                raise CliError(f"watermark ID {payload} is already registered; choose another")
            payload = secrets.randbelow(65536)
        else:
            raise CliError("could not find an unused watermark ID after 50 tries")

    tmp = tempfile.mkdtemp(prefix="rp-issue-")
    src16 = to_16k_mono(args.input, os.path.join(tmp, "src16.wav"))
    protected = os.path.join(args.out_dir, "protected.wav")
    gen, _ = load_models()
    embed(gen, src16, protected, payload, args.alpha)

    manifest = {
        "schema": MANIFEST_SCHEMA,
        "title": args.title,
        "issuer": args.issuer,
        "issuerKeyId": args.key_id,
        "watermarkId": payload,
        "watermark": {"model": MODEL, "alpha": args.alpha},
        "asset": {"file": os.path.basename(protected), "sha256": sha256_file(protected),
                  "sampleRate": SR, "channels": 1, "codec": "pcm_s16le"},
        "createdAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "createdAtNote": "issuer-asserted, not independently proven",
    }
    digest = manifest_digest(manifest)
    with open(os.path.join(args.out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    receipt = {"manifestDigest": digest, "credentialId": digest, "watermarkId": payload,
               "issuerKeyHash": "0x" + bytes(Web3.keccak(text=args.key_id)).hex(), "registered": False}

    if args.register:
        acct = w3.eth.account.from_key(load_key())
        if w3.eth.get_balance(acct.address) == 0:
            raise CliError(f"{acct.address} has 0 MON on chain {dep['chainId']}. Fund it first.")
        cid = bytes.fromhex(digest)
        if contract.functions.getRecord(cid).call()[0] != ZERO_ADDRESS:
            raise CliError("this exact manifest is already registered")
        fn = contract.functions.register(cid, cid, bytes.fromhex(receipt["issuerKeyHash"][2:]), payload)
        tx = fn.build_transaction({"from": acct.address, "nonce": w3.eth.get_transaction_count(acct.address),
                                   "chainId": dep["chainId"], "gasPrice": w3.eth.gas_price})
        tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.2)
        signed = acct.sign_transaction(tx)
        txh = w3.eth.send_raw_transaction(signed.raw_transaction)
        txhex = "0x" + bytes(txh).hex()
        rcpt = w3.eth.wait_for_transaction_receipt(txh, timeout=180)
        if rcpt.status != 1:
            raise CliError(f"register tx reverted: {txhex}")
        rec = contract.functions.getRecord(cid).call()
        if rec[1].hex() != digest or rec[3] != payload:
            raise CliError("read-back mismatch after register")
        receipt.update({"registered": True, "transactionHash": txhex, "blockNumber": rcpt.blockNumber,
                        "chainId": dep["chainId"], "contract": dep["address"], "issuer": acct.address})
        if dep["chainId"] == 10143:
            receipt["explorer"] = f"https://testnet.monadscan.com/tx/{txhex}"
    with open(os.path.join(args.out_dir, "receipt.json"), "w") as f:
        json.dump(receipt, f, indent=2)
        f.write("\n")
    print(json.dumps({"watermarkId": payload, "manifest": os.path.join(args.out_dir, "manifest.json"),
                      "protected": protected, "receipt": receipt}, indent=2))


def cmd_verify(args):
    result = {"input": args.input, "inputSha256": sha256_file(args.input)}
    tmp = tempfile.mkdtemp(prefix="rp-verify-")
    wav = to_16k_mono(args.input, os.path.join(tmp, "in16.wav"))
    _, det = load_models()
    prob, detected = detect(det, wav)
    result.update({"detectProb": round(prob, 4), "detectedWatermarkId": detected})

    manifest = None
    manifest_id = None
    digest = None
    if args.manifest:
        manifest = json.load(open(args.manifest))
        digest = manifest_digest(manifest)
        manifest_id = manifest["watermarkId"]
        result["manifestDigest"] = "0x" + digest
        result["exactAssetMatch"] = result["inputSha256"] == manifest["asset"]["sha256"]

    trusted = None
    if args.trusted_issuer:
        trusted = [a.lower() for a in args.trusted_issuer]

    exact, near = [], []
    registry_checked = False
    if args.deployment and prob >= DETECT_PROB_THRESHOLD:
        w3, contract, dep = load_registry(args.deployment, args.rpc)
        registry_checked = True
        # Look up the ID the manifest claims when it is close enough, else what was detected.
        lookup_id = detected
        if manifest_id is not None and hamming(detected, manifest_id) <= NEAR_TOLERANCE:
            lookup_id = manifest_id
        exact = registrations(w3, contract, dep, lookup_id)
        if manifest_id is None and not exact:
            near = registrations(w3, contract, dep, None, near_to=detected)
        for group in (exact, near):
            for c in group:
                c.pop("watermarkId", None)

    verdict, extra = decide(prob, detected, manifest_id, digest, exact, near, trusted, registry_checked)
    result["verdict"] = verdict
    if "bitErrors" in extra:
        result["bitErrors"] = extra["bitErrors"]
    if "candidate" in extra:
        result["candidate"] = extra["candidate"]
    if "candidates" in extra:
        result["candidates"] = extra["candidates"]
    if "nearCandidates" in extra:
        result["nearCandidates"] = extra["nearCandidates"]
    if prob < DETECT_PROB_THRESHOLD:
        result["watermarkId"] = None
    else:
        result["watermarkId"] = detected
    print(json.dumps(result, indent=2))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("issue")
    i.add_argument("--input", required=True)
    i.add_argument("--out-dir", required=True)
    i.add_argument("--title", required=True)
    i.add_argument("--issuer", required=True)
    i.add_argument("--key-id", required=True)
    i.add_argument("--alpha", type=float, default=DEFAULT_ALPHA,
                   help="watermark strength (default %(default)s; higher survives more noise, lower quality)")
    i.add_argument("--payload", type=int, help="fixed 16-bit ID (testing only)")
    i.add_argument("--register", action="store_true")
    i.add_argument("--deployment")
    i.add_argument("--rpc")
    i.set_defaults(func=cmd_issue)
    v = sub.add_parser("verify")
    v.add_argument("--input", required=True)
    v.add_argument("--manifest")
    v.add_argument("--deployment")
    v.add_argument("--rpc")
    v.add_argument("--trusted-issuer", action="append",
                   help="accept only registrations from this address (repeatable)")
    v.set_defaults(func=cmd_verify)
    args = p.parse_args()
    if getattr(args, "register", False) and not args.deployment:
        p.error("--register needs --deployment")
    try:
        args.func(args)
    except CliError as exc:
        print(f"error: {exc.code}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
