"""Tests for the local-request guard (Host and Origin checks) in server/app.py.

Why these tests exist: CORS is a browser read-restriction, not an access
control. Browsers still send "simple" cross-site requests (for example a
multipart POST) to 127.0.0.1 without a preflight, and DNS rebinding can make
a hostile hostname resolve to loopback. The guard rejects both before any
route runs.

Run with:  python3 -m unittest server.test_local_guard
Requires:  fastapi, httpx (for TestClient), python-multipart.
"""

from __future__ import annotations

import os
import unittest
from unittest import mock

try:
    from fastapi.testclient import TestClient

    from server.app import app
except ImportError as exc:  # pragma: no cover - environment guard
    raise unittest.SkipTest(f"server dependencies not installed: {exc}")

EXT_ID = "abcdefghijklmnopabcdefghijklmnop"
LOCAL_HOST = {"host": "127.0.0.1:8000"}
STATUS_PATH = "/api/sbr/health"  # no optional native dependencies needed


def _env(**overrides):
    base = {
        "RELAYPROOF_EXTENSION_ID": "",
        "RELAYPROOF_ALLOWED_ORIGINS": "",
        "RELAYPROOF_ALLOWED_HOSTS": "",
        "RELAYPROOF_API_TOKEN": "",
    }
    base.update(overrides)
    return mock.patch.dict(os.environ, base, clear=False)


class LocalRequestGuardTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, base_url="http://127.0.0.1:8000")

    def test_loopback_request_without_origin_is_allowed(self):
        with _env():
            response = self.client.get(STATUS_PATH, headers=LOCAL_HOST)
        self.assertEqual(response.status_code, 200)

    def test_dns_rebinding_host_header_is_rejected(self):
        with _env():
            response = self.client.get(STATUS_PATH, headers={"host": "attacker.example:8000"})
        self.assertEqual(response.status_code, 403)

    def test_cross_site_simple_post_is_rejected_before_route_runs(self):
        # A browser page on evil.example can send a multipart POST without a
        # preflight. The guard must refuse it even though the Host is loopback.
        with _env():
            response = self.client.post(
                "/api/fingerprint",
                headers={**LOCAL_HOST, "origin": "https://evil.example"},
                files={"file": ("a.wav", b"RIFF", "audio/wav")},
            )
        self.assertEqual(response.status_code, 403)

    def test_extension_origin_is_rejected_when_id_not_configured(self):
        with _env():
            response = self.client.get(
                STATUS_PATH,
                headers={**LOCAL_HOST, "origin": f"chrome-extension://{EXT_ID}"},
            )
        self.assertEqual(response.status_code, 403)

    def test_configured_extension_origin_is_allowed(self):
        with _env(RELAYPROOF_EXTENSION_ID=EXT_ID):
            response = self.client.get(
                STATUS_PATH,
                headers={**LOCAL_HOST, "origin": f"chrome-extension://{EXT_ID}"},
            )
        self.assertEqual(response.status_code, 200)

    def test_other_extension_id_is_rejected(self):
        other = "ponmlkjihgfedcbaponmlkjihgfedcba"
        with _env(RELAYPROOF_EXTENSION_ID=EXT_ID):
            response = self.client.get(
                STATUS_PATH,
                headers={**LOCAL_HOST, "origin": f"chrome-extension://{other}"},
            )
        self.assertEqual(response.status_code, 403)

    def test_explicit_allowed_origin_is_honoured(self):
        with _env(RELAYPROOF_ALLOWED_ORIGINS="http://localhost:5173"):
            allowed = self.client.get(
                STATUS_PATH, headers={**LOCAL_HOST, "origin": "http://localhost:5173"}
            )
            denied = self.client.get(
                STATUS_PATH, headers={**LOCAL_HOST, "origin": "http://localhost:3000"}
            )
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(denied.status_code, 403)

    def test_extra_allowed_host_is_honoured(self):
        with _env(RELAYPROOF_ALLOWED_HOSTS="media.internal.example"):
            response = self.client.get(STATUS_PATH, headers={"host": "media.internal.example:8000"})
        self.assertEqual(response.status_code, 200)

    def test_ipv6_loopback_host_is_allowed(self):
        with _env():
            response = self.client.get(STATUS_PATH, headers={"host": "[::1]:8000"})
        self.assertEqual(response.status_code, 200)


class ApiTokenTests(unittest.TestCase):
    TOKEN = "t0k3n-for-tests-only-0123456789"

    def setUp(self):
        self.client = TestClient(app, base_url="http://127.0.0.1:8000")

    def test_token_missing_is_rejected(self):
        with _env(RELAYPROOF_API_TOKEN=self.TOKEN):
            response = self.client.get(STATUS_PATH, headers=LOCAL_HOST)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers.get("www-authenticate"), "Bearer")

    def test_wrong_token_is_rejected(self):
        with _env(RELAYPROOF_API_TOKEN=self.TOKEN):
            response = self.client.get(
                STATUS_PATH, headers={**LOCAL_HOST, "authorization": "Bearer nope"}
            )
        self.assertEqual(response.status_code, 401)

    def test_correct_token_is_accepted(self):
        with _env(RELAYPROOF_API_TOKEN=self.TOKEN):
            response = self.client.get(
                STATUS_PATH, headers={**LOCAL_HOST, "authorization": f"Bearer {self.TOKEN}"}
            )
        self.assertEqual(response.status_code, 200)

    def test_token_is_not_required_when_unset(self):
        with _env():
            response = self.client.get(STATUS_PATH, headers=LOCAL_HOST)
        self.assertEqual(response.status_code, 200)

    def test_token_does_not_bypass_host_or_origin_rules(self):
        with _env(RELAYPROOF_API_TOKEN=self.TOKEN):
            response = self.client.get(
                STATUS_PATH,
                headers={
                    "host": "attacker.example:8000",
                    "authorization": f"Bearer {self.TOKEN}",
                },
            )
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
