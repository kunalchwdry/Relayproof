"""Offline regression tests for partial-scan state and reporting."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import competitor_watch as watch


class CompetitorWatchTests(unittest.TestCase):
    def run_with_fakes(self, directory: Path, watchlist: dict, state: dict, fake_collect, extra_args: list[str] | None = None) -> tuple[dict, str, str]:
        watchlist_path = directory / "watchlist.json"
        state_path = directory / "state.json"
        report_path = directory / "latest.md"
        output_path = directory / "github-output.txt"
        watchlist_path.write_text(json.dumps(watchlist), encoding="utf-8")
        state_path.write_text(json.dumps(state), encoding="utf-8")
        argv = [
            "competitor_watch.py",
            "--watchlist", str(watchlist_path),
            "--state", str(state_path),
            "--report", str(report_path),
            "--github-output", str(output_path),
            *(extra_args or []),
        ]
        with patch.object(sys, "argv", argv), patch.object(watch, "collect_parallel", side_effect=fake_collect):
            self.assertEqual(watch.main(), 0)
        saved_state = json.loads(state_path.read_text(encoding="utf-8"))
        report = report_path.read_text(encoding="utf-8")
        output = output_path.read_text(encoding="utf-8")
        return saved_state, report, output

    def test_partial_run_retains_last_good_repo_and_labels_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            prior_record = {"slug": "org/two", "url": "https://github.com/org/two", "latest_sha": "old"}
            state = {
                "version": 1,
                "initialized_at": "2026-10-01T00:00:00+00:00",
                "baseline_complete": False,
                "repos": {"org/two": prior_record},
                "issues": {}, "pages": {}, "search_results": {}, "search_candidates": [],
            }
            watchlist = {
                "version": 2,
                "repos": [{"slug": "org/one"}, {"slug": "org/two"}],
                "issues": [], "pages": [], "github_searches": [],
            }
            fresh = {"slug": "org/one", "url": "https://github.com/org/one", "latest_sha": "new"}

            def fake_collect(items, checker):
                if checker is watch.check_repo:
                    return {"org/one": fresh}, {"org/two": "request failed: HTTP 403"}
                return {}, {}

            saved, report, output = self.run_with_fakes(directory, watchlist, state, fake_collect)
            self.assertEqual(saved["repos"]["org/two"], prior_record)
            self.assertEqual(saved["repos"]["org/one"], fresh)
            self.assertFalse(saved["baseline_complete"])
            self.assertIn("Scan status — partial", report)
            self.assertIn("repositories 1/2", report)
            self.assertIn("last saved observation", report)
            self.assertIn("among successfully checked sources", report)
            self.assertIn("state_updated=true", output)
            self.assertIn("incomplete=true", output)

    def test_zero_success_updates_report_but_leaves_state_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            state = {
                "version": 1,
                "initialized_at": "2026-10-01T00:00:00+00:00",
                "baseline_complete": False,
                "repos": {"org/repo": {"slug": "org/repo", "latest_sha": "saved"}},
                "issues": {}, "pages": {}, "search_results": {}, "search_candidates": [],
            }
            watchlist = {
                "version": 2,
                "repos": [{"slug": "org/repo"}],
                "issues": [], "pages": [], "github_searches": [],
            }

            def fake_collect(items, checker):
                if checker is watch.check_repo:
                    return {}, {"org/repo": "request failed: HTTP 403"}
                return {}, {}

            state_path = directory / "state.json"
            original = json.dumps(state)
            saved, report, output = self.run_with_fakes(directory, watchlist, state, fake_collect)
            self.assertEqual(saved, state)
            self.assertIn("No tracked changes were found among successfully checked sources", report)
            self.assertIn("partial", report)
            self.assertIn("state_updated=false", output)
            self.assertIn("incomplete=true", output)
            self.assertEqual(state_path.read_text(encoding="utf-8"), original)

    def test_successful_catch_up_marks_baseline_complete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            state = {
                "version": 1,
                "initialized_at": "2026-10-01T00:00:00+00:00",
                "baseline_complete": False,
                "repos": {}, "issues": {}, "pages": {}, "search_results": {}, "search_candidates": [],
            }
            watchlist = {
                "version": 2,
                "repos": [{"slug": "org/repo"}],
                "issues": [], "pages": [], "github_searches": [],
            }
            fresh = {"slug": "org/repo", "url": "https://github.com/org/repo", "latest_sha": "abc"}

            def fake_collect(items, checker):
                if checker is watch.check_repo:
                    return {"org/repo": fresh}, {}
                return {}, {}

            saved, report, output = self.run_with_fakes(directory, watchlist, state, fake_collect)
            self.assertTrue(saved["baseline_complete"])
            self.assertIn("Scan status — complete", report)
            self.assertIn("Baseline coverage now complete", report)
            self.assertIn("repositories 1/1", report)
            self.assertIn("incomplete=false", output)


if __name__ == "__main__":
    unittest.main()
