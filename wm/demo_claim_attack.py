#!/usr/bin/env python3
"""Demonstrate the 'claim someone else's watermark' attack. Local chain only.

An attacker who knows a victim's watermark ID and file hash can register their
own manifest that uses the same ID and hash. The registry accepts it, because
anyone can register. Verification then depends on which issuer you trust.

Usage (env ATTACKER_KEY must be set; never use a real key here):
  python3 demo_claim_attack.py --victim-manifest out/manifest.json \
      --deployment chain/deployments/localhost.json --out attacker.json
"""
import argparse
import datetime as dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import relayproof_wm as rp  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--victim-manifest", required=True)
    p.add_argument("--deployment", required=True)
    p.add_argument("--rpc")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    victim = json.load(open(args.victim_manifest))
    forged = dict(victim)
    forged["issuer"] = "Attacker Media Ltd"
    forged["issuerKeyId"] = "attacker-key-1"
    forged["title"] = "Original footage (claimed)"
    forged["createdAt"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    digest = rp.manifest_digest(forged)
    json.dump(forged, open(args.out, "w"), indent=2)

    from web3 import Web3
    w3, contract, dep = rp.load_registry(args.deployment, args.rpc)
    acct = w3.eth.account.from_key(os.environ["ATTACKER_KEY"])
    cid = bytes.fromhex(digest)
    key_hash = bytes(Web3.keccak(text=forged["issuerKeyId"]))
    tx = contract.functions.register(cid, cid, key_hash, victim["watermarkId"]).build_transaction(
        {"from": acct.address, "nonce": w3.eth.get_transaction_count(acct.address),
         "chainId": dep["chainId"], "gasPrice": w3.eth.gas_price})
    tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.2)
    signed = acct.sign_transaction(tx)
    rcpt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))
    print(json.dumps({"attacker": acct.address, "status": rcpt.status, "forgedManifest": args.out,
                      "forgedDigest": "0x" + digest, "claimedWatermarkId": victim["watermarkId"]}, indent=2))


if __name__ == "__main__":
    main()
