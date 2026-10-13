"""Unit tests for the pure parts of relayproof_wm.py (no torch, no network).

Run: python3 -m unittest wm.test_relayproof_wm   (from the project root)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import relayproof_wm as rp  # noqa: E402

DIGEST_A = "a" * 64
DIGEST_B = "b" * 64
ISSUER = "0x4E7B07B759CfA103d04482C7183913828977ae35"
ATTACKER = "0x1111111111111111111111111111111111111111"


def reg(digest_hex, issuer=ISSUER, status="active"):
    return {"credentialId": "0x" + digest_hex, "issuer": issuer,
            "manifestDigest": "0x" + digest_hex, "status": status}


class HelperTests(unittest.TestCase):
    def test_bits_round_trip(self):
        for payload in (0, 1, 4243, 32768, 65535):
            self.assertEqual(rp.int_of(rp.bits_of(payload)), payload)

    def test_hamming(self):
        self.assertEqual(rp.hamming(0b1011, 0b1011), 0)
        self.assertEqual(rp.hamming(0b1011, 0b0011), 1)
        self.assertEqual(rp.hamming(0, 0xFFFF), 16)

    def test_canonical_ignores_key_order(self):
        a = {"b": 1, "a": "x", "c": {"z": 2, "y": 3}}
        b = {"c": {"y": 3, "z": 2}, "a": "x", "b": 1}
        self.assertEqual(rp.canonical(a), rp.canonical(b))

    def test_digest_changes_with_any_field(self):
        base = {"title": "t", "watermarkId": 1, "asset": {"sha256": "x"}}
        changed = {"title": "T", "watermarkId": 1, "asset": {"sha256": "x"}}
        self.assertNotEqual(rp.manifest_digest(base), rp.manifest_digest(changed))


class DecideTests(unittest.TestCase):
    PROB_OK = 0.99

    def decide(self, prob=PROB_OK, detected=1234, manifest_id=None, digest=None,
               exact=(), near=(), trusted=None, checked=True):
        return rp.decide(prob, detected, manifest_id, digest, list(exact), list(near),
                         trusted, checked)

    def test_no_watermark(self):
        v, _ = self.decide(prob=0.01)
        self.assertEqual(v, "no_watermark_detected")

    def test_manifest_id_too_far_from_detected(self):
        v, extra = self.decide(detected=0, manifest_id=0xFFFF, digest=DIGEST_A, exact=[reg(DIGEST_A)])
        self.assertEqual(v, "watermark_mismatch_with_manifest")
        self.assertEqual(extra["bitErrors"], 16)

    def test_registry_not_checked(self):
        v, _ = self.decide(checked=False)
        self.assertEqual(v, "watermark_detected_registry_not_checked")

    def test_manifest_match_active(self):
        v, extra = self.decide(manifest_id=1234, digest=DIGEST_A, exact=[reg(DIGEST_A)])
        self.assertEqual(v, "registered_active_manifest_match")

    def test_manifest_match_tolerates_bit_errors(self):
        v, extra = self.decide(detected=1234 ^ 0b11, manifest_id=1234, digest=DIGEST_A,
                               exact=[reg(DIGEST_A)])
        self.assertEqual(v, "registered_active_manifest_match")
        self.assertEqual(extra["bitErrors"], 2)

    def test_manifest_digest_mismatch(self):
        v, _ = self.decide(manifest_id=1234, digest=DIGEST_B, exact=[reg(DIGEST_A)])
        self.assertEqual(v, "manifest_digest_mismatch")

    def test_manifest_disambiguates_two_registrations(self):
        exact = [reg(DIGEST_A, issuer=ATTACKER), reg(DIGEST_B)]
        v, extra = self.decide(manifest_id=1234, digest=DIGEST_B, exact=exact)
        self.assertEqual(v, "registered_active_manifest_match")
        self.assertEqual(extra["candidate"]["issuer"], ISSUER)

    def test_two_registrations_without_manifest_is_ambiguous(self):
        v, _ = self.decide(exact=[reg(DIGEST_A), reg(DIGEST_B, issuer=ATTACKER)])
        self.assertEqual(v, "ambiguous_watermark_id")

    def test_revoked_with_manifest(self):
        v, _ = self.decide(manifest_id=1234, digest=DIGEST_A, exact=[reg(DIGEST_A, status="revoked")])
        self.assertEqual(v, "registered_revoked")

    def test_untrusted_issuer_is_flagged(self):
        v, _ = self.decide(manifest_id=1234, digest=DIGEST_A, exact=[reg(DIGEST_A, issuer=ATTACKER)],
                           trusted=[ISSUER.lower()])
        self.assertEqual(v, "registered_untrusted_issuer")

    def test_trusted_issuer_passes(self):
        v, _ = self.decide(manifest_id=1234, digest=DIGEST_A, exact=[reg(DIGEST_A)],
                           trusted=[ISSUER.lower()])
        self.assertEqual(v, "registered_active_manifest_match")

    def test_not_registered(self):
        v, _ = self.decide(manifest_id=1234, digest=DIGEST_A, exact=[])
        self.assertEqual(v, "watermark_not_registered")

    def test_no_manifest_exact_match_is_not_a_full_match(self):
        v, _ = self.decide(exact=[reg(DIGEST_A)])
        self.assertEqual(v, "registered_active_manifest_not_checked")

    def test_no_manifest_near_match_is_only_possible(self):
        v, extra = self.decide(exact=[], near=[reg(DIGEST_A)])
        self.assertEqual(v, "possible_registration_needs_manifest")
        self.assertIn("nearCandidates", extra)

    def test_no_manifest_nothing_found(self):
        v, _ = self.decide(exact=[], near=[])
        self.assertEqual(v, "watermark_not_registered")


if __name__ == "__main__":
    unittest.main()
