from __future__ import annotations

import unittest

from server.sbr_contract import (
    SBR_ADAPTER_CONTRACT,
    SBRContractError,
    SBRIssueArtifact,
    normalize_resolution,
    sbr_adapter_status,
    validate_issue_artifact,
)


class SBRContractTests(unittest.TestCase):
    def test_readiness_fails_closed_until_provider_is_configured(self):
        status = sbr_adapter_status()
        self.assertFalse(status["available"])
        self.assertEqual(status["state"], "not_configured")
        self.assertEqual(status["contract"], SBR_ADAPTER_CONTRACT)
        self.assertIn("Exact-file verification remains available", status["message"])

    def test_issue_artifact_requires_protected_bytes_and_receipt(self):
        artifact = validate_issue_artifact({
            "protected_media": b"bound media bytes",
            "filename": "sample.bound.wav",
            "receipt": {"provider": "test-provider", "method": "opaque-demo"},
        })
        self.assertIsInstance(artifact, SBRIssueArtifact)
        self.assertEqual(artifact.filename, "sample.bound.wav")

    def test_issue_rejects_empty_media_and_path_traversal(self):
        base = {"protected_media": b"x", "filename": "sample.wav", "receipt": {"provider": "p", "method": "m"}}
        with self.assertRaises(SBRContractError):
            validate_issue_artifact({**base, "protected_media": b""})
        with self.assertRaises(SBRContractError):
            validate_issue_artifact({**base, "filename": "../sample.wav"})

    def test_recovered_result_requires_candidate_and_evidence(self):
        good = normalize_resolution({
            "status": "recovered",
            "provider": "test-provider",
            "method": "test-only",
            "binding_id": "demo-1",
            "credential": {"schema": "relayproof.media-credential.v1"},
            "evidence": {"fixture": True},
        })
        self.assertEqual(good.status, "recovered")
        rendered = good.as_dict()
        self.assertNotIn("authentic", rendered)
        self.assertNotIn("trusted", rendered)
        self.assertIn("independently verify", rendered["message"])

        with self.assertRaises(SBRContractError):
            normalize_resolution({
                "status": "recovered", "provider": "p", "method": "m",
                "credential": {}, "evidence": {"match": True},
            })
        with self.assertRaises(SBRContractError):
            normalize_resolution({
                "status": "recovered", "provider": "p", "method": "m",
                "credential": {"id": "x"}, "evidence": {},
            })

    def test_no_match_is_not_fake_and_stray_credential_is_discarded(self):
        result = normalize_resolution({
            "status": "no_match", "provider": "test-provider", "method": "test-only",
            "credential": {"unexpected": "must not leak"},
        })
        rendered = result.as_dict()
        self.assertIsNone(rendered["credential"])
        self.assertIn("does not mean the media is fake", rendered["message"])

    def test_indeterminate_is_not_a_failure_verdict(self):
        result = normalize_resolution({
            "status": "indeterminate", "provider": "test-provider", "method": "test-only",
        })
        self.assertEqual(result.status, "indeterminate")
        self.assertNotIn("fake", result.as_dict()["message"].lower())

    def test_rejects_unknown_status(self):
        with self.assertRaises(SBRContractError):
            normalize_resolution({"status": "authentic", "provider": "p", "method": "m"})


if __name__ == "__main__":
    unittest.main()
