#!/usr/bin/env bash
# End-to-end test of issue/verify against a local Hardhat chain (chain 31337).
# Free, offline, and needs no faucet. Uses Hardhat's PUBLIC dev keys, which are
# worthless outside this script. Never point these keys at a real network.
#
# Prereqs: wm/setup_env.sh has run (Python env), and chain/ has npm ci done.
# Usage: wm/e2e_local.sh [python-path]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="${1:-$HOME/.cache/wm-venv/bin/python}"
RPC="http://127.0.0.1:8545"
# Keys come from the environment so no private key literal is committed. Use the public
# Hardhat dev keys for accounts 0 and 1 (printed by `npx hardhat node`) for local runs only.
: "${E2E_DEPLOY_KEY:?set E2E_DEPLOY_KEY to a local Hardhat dev key (account 0)}"
: "${E2E_ATTACKER_KEY:?set E2E_ATTACKER_KEY to a local Hardhat dev key (account 1)}"
DEPLOY_KEY="$E2E_DEPLOY_KEY"
ATTACKER_KEY="$E2E_ATTACKER_KEY"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/rp-e2e-XXXX")"
DEPLOY_FILE="$ROOT/chain/deployments/localhost.json"
NODE_LOG="$WORK/node.log"
CLIP="$ROOT/wm/spike/clips/unmarked_03.wav"
UNMARKED="$ROOT/wm/spike/clips/unmarked_04.wav"
pass=0; fail=0

cleanup() {
  [ -n "${NODE_PID:-}" ] && kill "$NODE_PID" 2>/dev/null && wait "$NODE_PID" 2>/dev/null || true
  rm -f "$DEPLOY_FILE"
  rm -rf "$WORK"
}
trap cleanup EXIT

check() {  # check <label> <expected-verdict> <json-file>
  local got
  got="$("$PY" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("verdict"))' "$3")"
  if [ "$got" = "$2" ]; then pass=$((pass+1)); echo "PASS $1: $got"
  else fail=$((fail+1)); echo "FAIL $1: expected $2, got $got"; fi
}

echo "== start local chain"
# exec so the PID we kill is the node process itself (npx would leave children running).
(cd "$ROOT/chain" && exec ./node_modules/.bin/hardhat node --port 8545 > "$NODE_LOG" 2>&1) &
NODE_PID=$!
for _ in $(seq 1 60); do
  curl -s -m 2 -X POST "$RPC" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1 && break
  sleep 1
done

echo "== deploy registry"
(cd "$ROOT/chain" && npx hardhat run scripts/deploy.js --network localhost > "$WORK/deploy.log" 2>&1) \
  || { cat "$WORK/deploy.log"; exit 1; }

CLI="$PY $ROOT/wm/relayproof_wm.py"
export RELAYPROOF_TESTNET_KEY="$DEPLOY_KEY"
DEP="$DEPLOY_FILE"

echo "== issue + register (victim)"
$CLI issue --input "$CLIP" --out-dir "$WORK/victim" --title "Victim clip" --issuer "Victim Newsroom" \
  --key-id victim-key-1 --register --deployment "$DEP" > "$WORK/issue.json" 2>"$WORK/issue.err" \
  || { cat "$WORK/issue.err"; exit 1; }
VICTIM_ID="$("$PY" -c 'import json;print(json.load(open("'"$WORK/issue.json"'"))["watermarkId"])')"
DEPLOYER="$("$PY" -c 'import json;print(json.load(open("'"$WORK/victim/receipt.json"'"))["issuer"])')"
echo "watermark ID $VICTIM_ID issued by $DEPLOYER"

echo "== verify: original, Opus re-encode, tampered manifest, unmarked"
$CLI verify --input "$WORK/victim/protected.wav" --manifest "$WORK/victim/manifest.json" --deployment "$DEP" \
  > "$WORK/v1.json" 2>/dev/null
check "original" registered_active_manifest_match "$WORK/v1.json"

FF="$("$PY" -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')"
"$FF" -y -loglevel error -i "$WORK/victim/protected.wav" -c:a libopus -b:a 32k "$WORK/reenc.opus"
$CLI verify --input "$WORK/reenc.opus" --manifest "$WORK/victim/manifest.json" --deployment "$DEP" \
  > "$WORK/v2.json" 2>/dev/null
check "opus 32k re-encode" registered_active_manifest_match "$WORK/v2.json"

sed 's/Victim clip/Edited clip/' "$WORK/victim/manifest.json" > "$WORK/tampered.json"
$CLI verify --input "$WORK/victim/protected.wav" --manifest "$WORK/tampered.json" --deployment "$DEP" \
  > "$WORK/v3.json" 2>/dev/null
check "tampered manifest" manifest_digest_mismatch "$WORK/v3.json"

$CLI verify --input "$UNMARKED" --manifest "$WORK/victim/manifest.json" --deployment "$DEP" \
  > "$WORK/v4.json" 2>/dev/null
check "unmarked clip" no_watermark_detected "$WORK/v4.json"

$CLI verify --input "$WORK/victim/protected.wav" --deployment "$DEP" > "$WORK/v5.json" 2>/dev/null
check "no manifest" registered_active_manifest_not_checked "$WORK/v5.json"

echo "== collision guard: re-using a registered ID must fail"
if $CLI issue --input "$CLIP" --out-dir "$WORK/dup" --title "Dup" --issuer "X" --key-id k \
     --payload "$VICTIM_ID" --register --deployment "$DEP" >/dev/null 2>"$WORK/dup.err"; then
  fail=$((fail+1)); echo "FAIL collision guard: issue succeeded"
else
  pass=$((pass+1)); echo "PASS collision guard: $(cat "$WORK/dup.err")"
fi

echo "== claim attack: a second account registers the victim's ID and file hash"
ATTACKER_KEY="$ATTACKER_KEY" $PY "$ROOT/wm/demo_claim_attack.py" --victim-manifest "$WORK/victim/manifest.json" \
  --deployment "$DEP" --out "$WORK/attacker.json" > "$WORK/attack.json"
ATTACKER="$("$PY" -c 'import json;print(json.load(open("'"$WORK/attack.json"'"))["attacker"])')"
$CLI verify --input "$WORK/victim/protected.wav" --deployment "$DEP" > "$WORK/a1.json" 2>/dev/null
check "victim file, no manifest, after attack" ambiguous_watermark_id "$WORK/a1.json"
$CLI verify --input "$WORK/victim/protected.wav" --manifest "$WORK/victim/manifest.json" --deployment "$DEP" \
  > "$WORK/a2.json" 2>/dev/null
check "victim manifest, after attack" registered_active_manifest_match "$WORK/a2.json"
$CLI verify --input "$WORK/victim/protected.wav" --manifest "$WORK/attacker.json" --deployment "$DEP" \
  > "$WORK/a3.json" 2>/dev/null
check "forged manifest, no trust list (WEAKNESS)" registered_active_manifest_match "$WORK/a3.json"
$CLI verify --input "$WORK/victim/protected.wav" --manifest "$WORK/attacker.json" --deployment "$DEP" \
  --trusted-issuer "$DEPLOYER" > "$WORK/a4.json" 2>/dev/null
check "forged manifest, trust list" registered_untrusted_issuer "$WORK/a4.json"
$CLI verify --input "$WORK/victim/protected.wav" --manifest "$WORK/victim/manifest.json" --deployment "$DEP" \
  --trusted-issuer "$DEPLOYER" > "$WORK/a5.json" 2>/dev/null
check "victim manifest, trust list" registered_active_manifest_match "$WORK/a5.json"

echo
echo "passed=$pass failed=$fail"
echo "attacker address (Hardhat account 1, public dev key): $ATTACKER"
[ "$fail" -eq 0 ]
