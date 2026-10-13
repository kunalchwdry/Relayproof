#!/usr/bin/env python3
"""Watch a curated public-source list for RelayProof competitor changes.

Uses only Python's standard library. GitHub API token is optional; set
GITHUB_TOKEN in GitHub Actions to raise the unauthenticated API rate limit.
This is a change detector, not an AI analyst: findings require human review.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import html.parser
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
USER_AGENT = "RelayProof-Competitor-Watch/0.1 (public-source change monitor)"
MAX_BYTES = 8 * 1024 * 1024
TIMEOUT = 22


class VisibleTextParser(html.parser.HTMLParser):
    """Extract page text while skipping scripts/styles and other noisy nodes."""

    SKIP_TAGS = {"script", "style", "noscript", "svg", "canvas", "template"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in self.SKIP_TAGS:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in self.SKIP_TAGS and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._skip_depth and data.strip():
            self.parts.append(data)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def timestamp(value: str | None) -> str:
    if not value:
        return "unknown"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    except (ValueError, TypeError):
        return value


def request_bytes(url: str, *, github: bool = False) -> tuple[bytes, dict[str, str], str]:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json" if github else "text/html,application/json;q=0.9,*/*;q=0.8"}
    if github:
        headers["X-GitHub-Api-Version"] = "2022-11-28"
        token = os.environ.get("GITHUB_TOKEN", "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
    req = Request(url, headers=headers)
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            with urlopen(req, timeout=TIMEOUT) as response:
                body = response.read(MAX_BYTES + 1)
                if len(body) > MAX_BYTES:
                    body = body[:MAX_BYTES]
                response_headers = {k.lower(): v for k, v in response.headers.items()}
                content_type = response_headers.get("content-type", "")
                return body, response_headers, content_type
        except HTTPError as exc:
            last_error = exc
            if exc.code not in (429, 500, 502, 503, 504) or attempt:
                break
            time.sleep(1.5 * (attempt + 1))
        except (URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt:
                break
            time.sleep(1.0)
    raise RuntimeError(f"request failed: {type(last_error).__name__}: {last_error}")


def get_json(url: str) -> Any:
    body, _, _ = request_bytes(url, github=True)
    return json.loads(body.decode("utf-8", "replace"))


def check_repo(item: dict[str, str]) -> tuple[str, dict[str, Any] | None, str | None]:
    slug = item["slug"]
    try:
        repo = get_json(f"https://api.github.com/repos/{slug}")
        branch = repo.get("default_branch") or "main"
        commits = get_json(f"https://api.github.com/repos/{slug}/commits?per_page=1&sha={branch}")
        latest = commits[0] if isinstance(commits, list) and commits else {}
        commit = latest.get("commit", {})
        author = commit.get("author", {})
        record = {
            "slug": slug,
            "role": item.get("role", "").strip(),
            "url": repo.get("html_url", f"https://github.com/{slug}"),
            "description": repo.get("description") or "",
            "default_branch": branch,
            "pushed_at": repo.get("pushed_at"),
            "updated_at": repo.get("updated_at"),
            "archived": bool(repo.get("archived")),
            "stars": int(repo.get("stargazers_count") or 0),
            "latest_sha": (latest.get("sha") or "")[:12],
            "latest_message": (commit.get("message") or "").splitlines()[0][:240],
            "latest_commit_at": author.get("date") or commit.get("committer", {}).get("date"),
            "latest_commit_url": latest.get("html_url", ""),
        }
        return slug, record, None
    except Exception as exc:  # Keep one missing/deleted repo from stopping the scan.
        return slug, None, str(exc)


def check_issue(item: dict[str, str]) -> tuple[str, dict[str, Any] | None, str | None]:
    url = item["url"]
    try:
        issue = get_json(url)
        record = {
            "url": issue.get("html_url", url),
            "role": item.get("role", ""),
            "title": issue.get("title", ""),
            "state": issue.get("state", "unknown"),
            "updated_at": issue.get("updated_at"),
            "comments": int(issue.get("comments") or 0),
            "body_sha256": hashlib.sha256((issue.get("body") or "").encode("utf-8")).hexdigest(),
        }
        return url, record, None
    except Exception as exc:
        return url, None, str(exc)


def check_page(item: dict[str, str]) -> tuple[str, dict[str, Any] | None, str | None]:
    url = item["url"]
    try:
        body, headers, content_type = request_bytes(url)
        charset_match = re.search(r"charset=([\w.-]+)", content_type, re.I)
        charset = charset_match.group(1) if charset_match else "utf-8"
        try:
            text = body.decode(charset, "replace")
        except LookupError:
            text = body.decode("utf-8", "replace")
        if "html" in content_type.lower() or "<html" in text[:1000].lower():
            parser = VisibleTextParser()
            parser.feed(text)
            normalized = " ".join(" ".join(parser.parts).split())
        else:
            normalized = " ".join(text.split())
        fingerprint = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        record = {
            "name": item.get("name", url),
            "url": url,
            "etag": headers.get("etag", ""),
            "last_modified": headers.get("last-modified", ""),
            "text_sha256": fingerprint,
            "visible_text_chars": len(normalized),
        }
        return url, record, None
    except Exception as exc:
        return url, None, str(exc)


def check_search(item: dict[str, str]) -> tuple[str, list[dict[str, Any]] | None, str | None]:
    name = item["name"]
    try:
        params = urlencode({"q": item["query"], "sort": "updated", "order": "desc", "per_page": 10})
        result = get_json(f"https://api.github.com/search/repositories?{params}")
        items = []
        for repo in result.get("items", []):
            items.append({
                "full_name": repo.get("full_name", ""),
                "url": repo.get("html_url", ""),
                "description": repo.get("description") or "",
                "pushed_at": repo.get("pushed_at"),
                "stars": int(repo.get("stargazers_count") or 0),
                "query_name": name,
            })
        return name, items, None
    except Exception as exc:
        return name, None, str(exc)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def collect_parallel(items: list[dict[str, str]], checker: Any) -> tuple[dict[str, Any], dict[str, str]]:
    data: dict[str, Any] = {}
    errors: dict[str, str] = {}
    if not items:
        return data, errors
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(items))) as pool:
        futures = [pool.submit(checker, item) for item in items]
        for future in concurrent.futures.as_completed(futures):
            key, record, error = future.result()
            if error:
                errors[key] = error
            elif record is not None:
                data[key] = record
    return data, errors


def compare(previous: dict[str, Any], current: dict[str, Any], *, baseline: bool) -> list[dict[str, str]]:
    if baseline:
        return []
    changes: list[dict[str, str]] = []
    for slug, record in current.get("repos", {}).items():
        old = previous.get("repos", {}).get(slug)
        if old and (record.get("latest_sha") != old.get("latest_sha") or record.get("pushed_at") != old.get("pushed_at")):
            changes.append({
                "kind": "repo",
                "title": f"Repository activity: {slug}",
                "url": record.get("url", f"https://github.com/{slug}"),
                "detail": f"Latest visible commit: {record.get('latest_message') or 'message unavailable'} ({timestamp(record.get('latest_commit_at'))}). Role: {record.get('role', '')}.",
            })
    for url, record in current.get("issues", {}).items():
        old = previous.get("issues", {}).get(url)
        if old and (record.get("updated_at") != old.get("updated_at") or record.get("state") != old.get("state") or record.get("body_sha256") != old.get("body_sha256")):
            changes.append({
                "kind": "issue",
                "title": f"Issue changed: {record.get('title', url)}",
                "url": record.get("url", url),
                "detail": f"State: {old.get('state')} → {record.get('state')}; updated {timestamp(record.get('updated_at'))}. {record.get('role', '')}",
            })
    for url, record in current.get("pages", {}).items():
        old = previous.get("pages", {}).get(url)
        if old and record.get("text_sha256") != old.get("text_sha256"):
            changes.append({
                "kind": "page",
                "title": f"Page text changed: {record.get('name', url)}",
                "url": url,
                "detail": "The visible-text fingerprint changed. This can be a substantive update or routine site churn; review the source manually.",
            })
    old_candidates = set(previous.get("search_candidates", []))
    watched = set(current.get("repos", {}).keys())
    candidates: dict[str, dict[str, Any]] = {}
    for query_name, results in current.get("search_results", {}).items():
        for result in results:
            full_name = result.get("full_name", "")
            if full_name and full_name not in old_candidates and full_name not in watched:
                existing = candidates.get(full_name)
                if existing:
                    existing["query_name"] += f", {query_name}"
                else:
                    candidates[full_name] = {**result, "query_name": query_name}
    for candidate in candidates.values():
        changes.append({
            "kind": "candidate",
            "title": f"Newly surfaced GitHub candidate: {candidate['full_name']}",
            "url": candidate.get("url", ""),
            "detail": f"Found in: {candidate.get('query_name')}. {candidate.get('description') or 'No description.'} Last pushed {timestamp(candidate.get('pushed_at'))}; {candidate.get('stars', 0)} stars. This is a search lead, not a confirmed competitor or hackathon entrant.",
        })
    return changes


def markdown_report(current: dict[str, Any], changes: list[dict[str, str]], errors: dict[str, str], baseline: bool, scan_complete: bool, baseline_exists: bool, scan_counts: dict[str, tuple[int, int]], coverage_completed: bool) -> str:
    local_now = now_utc().astimezone()
    lines = [
        "# RelayProof competitor watch",
        "",
        f"**Checked:** {local_now.strftime('%Y-%m-%d %H:%M %Z')}  ",
        "**Scope:** Curated public GitHub repositories, configured repository-search queries, selected product/spec pages, and tracked implementation issues.",
        "**Interpretation:** Automated change signals only. A commit, page edit, or search hit is not proof of a shipped product, technical capability, or official hackathon entry.",
        "",
        f"## Scan status — {'complete' if scan_complete else 'partial'}",
        "",
        f"**Baseline coverage:** {'complete' if current.get('baseline_complete') else 'incomplete'}.",
        "**Sources checked:** " + "; ".join(f"{name} {done}/{expected}" for name, (done, expected) in scan_counts.items()) + ".",
        ("All configured sources responded in this run." if scan_complete else "Some configured sources could not be checked. Any unchanged-source conclusion below applies only to successful checks; failed sources may have changed."),
        "",
    ]
    if not baseline_exists:
        lines += ["## Baseline not established", "", "No source responded successfully, so no baseline was saved. Existing tables, if any, show only previously saved observations.", ""]
    elif baseline:
        baseline_note = "This is the first saved baseline snapshot. Future runs will report differences from this snapshot; nothing is being labelled as a newly emerged competitor in the baseline run."
        if not scan_complete:
            baseline_note += " The snapshot is incomplete and will be filled in as sources become reachable."
        lines += ["## Baseline created", "", baseline_note, ""]
    else:
        lines += ["## Changes since last baseline", ""]
        if changes:
            for change in changes:
                lines.append(f"- **{change['title']}** — {change['detail']} ([source]({change['url']}))")
        elif errors:
            lines.append("No tracked changes were found among successfully checked sources. This scan is incomplete; see the errors below.")
        else:
            lines.append("No tracked repo/page/issue changes or newly surfaced GitHub search candidates were detected.")
        lines.append("")
    if coverage_completed:
        lines += ["## Baseline coverage now complete", "", "This run filled the previously partial baseline for every configured source. Newly populated records are baseline additions, not automatically classified as new competitor activity.", ""]
    lines += ["Values below may be the last saved observation for sources that failed in this run; consult the error list before interpreting them.", "", "## Watched repositories", "", "| Repository | Role | Latest commit | Pushed | Stars |", "|---|---|---|---|---:|"]
    for slug, record in sorted(current.get("repos", {}).items()):
        commit = record.get("latest_commit_url")
        message = record.get("latest_message") or "—"
        commit_cell = f"[{message.replace('|', '/')} ]({commit})" if commit else message.replace("|", "/")
        lines.append(f"| [{slug}]({record.get('url')}) | {record.get('role', '').replace('|', '/')} | {commit_cell} | {timestamp(record.get('pushed_at'))} | {record.get('stars', 0)} |")
    lines += ["", "## Watched product/spec pages", "", "| Page | Status | Visible text fingerprint |", "|---|---|---|"]
    for url, record in sorted(current.get("pages", {}).items()):
        lines.append(f"| [{record.get('name', url)}]({url}) | checked | `{record.get('text_sha256', '')[:16]}` ({record.get('visible_text_chars', 0)} chars) |")
    lines += ["", "## Search-discovered repositories", "", "Search hits are bounded to the top ten repositories per query and should be reviewed manually.", ""]
    for query_name, results in sorted(current.get("search_results", {}).items()):
        lines.append(f"### {query_name}")
        if not results:
            lines.append("No results in the top-ten sample.")
        else:
            for item in results:
                lines.append(f"- [{item.get('full_name')}]({item.get('url')}) — {item.get('description') or 'No description.'} (pushed {timestamp(item.get('pushed_at'))}; {item.get('stars', 0)} stars)")
        lines.append("")
    if errors:
        lines += ["## Sources that could not be checked", ""]
        for key, error in sorted(errors.items()):
            lines.append(f"- `{key}` — {error}")
        lines.append("")
    lines += ["## Follow-up", "", "Open `COMPETITOR_COMPARISON.md` before changing product positioning. A human should inspect any new candidate or changed page and update that curated comparison only after verifying what actually shipped.", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--watchlist", type=Path, default=ROOT / "competitor-watchlist.json")
    parser.add_argument("--state", type=Path, default=ROOT / "data" / "competitor-watch-state.json")
    parser.add_argument("--report", type=Path, default=ROOT / "reports" / "competitor-watch" / "latest.md")
    parser.add_argument("--github-output", type=Path, help="GitHub Actions output file path")
    parser.add_argument("--no-search", action="store_true", help="Skip GitHub repository search (useful for rate-limited environments)")
    args = parser.parse_args()

    watchlist = json.loads(args.watchlist.read_text(encoding="utf-8"))
    previous = load_json(args.state, {})
    had_baseline = bool(previous.get("initialized_at"))

    repo_items = watchlist.get("repos", [])
    issue_items = watchlist.get("issues", [])
    page_items = watchlist.get("pages", [])
    search_items = watchlist.get("github_searches", [])

    repos, repo_errors = collect_parallel(repo_items, check_repo)
    issues, issue_errors = collect_parallel(issue_items, check_issue)
    pages, page_errors = collect_parallel(page_items, check_page)
    errors = {**repo_errors, **issue_errors, **page_errors}

    searches: dict[str, list[dict[str, Any]]] = {}
    if not args.no_search:
        # Search is deliberately sequential to stay under GitHub's search rate limit.
        for item in search_items:
            name, results, error = check_search(item)
            if error:
                errors[f"search:{name}"] = error
            elif results is not None:
                searches[name] = results
    else:
        errors["searches"] = "skipped by --no-search; this run is intentionally partial"

    any_success = bool(repos or issues or pages or searches)
    expected_sources = len(repo_items) + len(issue_items) + len(page_items) + len(search_items)
    scan_complete = (
        expected_sources > 0
        and len(repos) == len(repo_items)
        and len(issues) == len(issue_items)
        and len(pages) == len(page_items)
        and len(searches) == len(search_items)
        and not errors
    )
    baseline = not had_baseline and any_success
    baseline_exists = had_baseline or any_success
    scan_counts = {
        "repositories": (len(repos), len(repo_items)),
        "issues": (len(issues), len(issue_items)),
        "pages": (len(pages), len(page_items)),
        "searches": (len(searches), len(search_items)),
    }
    coverage_completed = bool(scan_complete and had_baseline and not previous.get("baseline_complete", False))

    old_search_results = previous.get("search_results", {})
    if not isinstance(old_search_results, dict):
        old_search_results = {}
    search_results = {**old_search_results, **searches}
    current = {
        "version": int(watchlist.get("version", 1)),
        "initialized_at": previous.get("initialized_at") or (now_utc().isoformat(timespec="seconds") if any_success else ""),
        "baseline_complete": bool(previous.get("baseline_complete", False) or scan_complete),
        "repos": {**previous.get("repos", {}), **repos},
        "issues": {**previous.get("issues", {}), **issues},
        "pages": {**previous.get("pages", {}), **pages},
        # Retain prior values for individual searches that failed this run.
        "search_results": search_results,
        "search_candidates": sorted(set(previous.get("search_candidates", [])) | {
            item.get("full_name", "")
            for result_list in searches.values()
            for item in result_list
            if item.get("full_name")
        }),
    }
    changes = compare(previous, current, baseline=baseline)
    state_updated = bool(any_success and current != previous)
    report_text = markdown_report(current, changes, errors, baseline, scan_complete, baseline_exists, scan_counts, coverage_completed)

    args.state.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    # Never replace a useful saved state with an empty failure-only snapshot.
    if any_success:
        args.state.write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    args.report.write_text(report_text, encoding="utf-8")

    if args.github_output:
        args.github_output.parent.mkdir(parents=True, exist_ok=True)
        with args.github_output.open("a", encoding="utf-8") as handle:
            handle.write(f"changed={'true' if changes else 'false'}\n")
            handle.write(f"baseline={'true' if baseline else 'false'}\n")
            handle.write(f"state_updated={'true' if state_updated else 'false'}\n")
            handle.write(f"incomplete={'true' if not scan_complete else 'false'}\n")
            handle.write(f"change_count={len(changes)}\n")
    print(f"Checked {len(repos)} repos, {len(issues)} issues, {len(pages)} pages, {len(searches)} GitHub searches.")
    print(f"Scan: {'complete' if scan_complete else 'partial'}; baseline exists: {'yes' if baseline_exists else 'no'}; coverage: {'complete' if current.get('baseline_complete') else 'incomplete'}; first snapshot this run: {'yes' if baseline else 'no'}; changes: {len(changes)}; report: {args.report}")
    if errors:
        print(f"Some sources could not be checked: {len(errors)} (details are in the report).")
    if not any_success:
        print("No successful source checks; saved state was left untouched.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
