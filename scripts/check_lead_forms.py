#!/usr/bin/env python3
"""Fail the build if lead forms regress to placeholders or missing local assets.

Scans site HTML, JS, CSS, XML, and text. Does not scan this script (it names
the forbidden patterns) or blog content rules beyond the same placeholder scan.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {".html", ".js", ".css", ".xml", ".txt", ".md"}
SKIP_DIRS = {".git", ".github", "scripts", "node_modules"}
ASSET_ATTR = re.compile(
    r"""<(?:script|img|source|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']""",
    re.IGNORECASE,
)
ASSET_EXT = re.compile(
    r"\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|pdf)(?:\?.*)?$",
    re.IGNORECASE,
)
FORBIDDEN = (
    re.compile(r"formspree", re.IGNORECASE),
    re.compile(r"YOUR_FORM_ID"),
    re.compile(r"REPLACE_WITH"),
    re.compile(r"555-"),
    re.compile(r"\(555\)"),
)


def iter_site_files() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        if path.suffix.lower() in TEXT_SUFFIXES:
            files.append(path)
    return files


def check_forbidden(files: list[Path]) -> list[str]:
    problems: list[str] = []
    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace")
        for pattern in FORBIDDEN:
            for match in pattern.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                rel = path.relative_to(ROOT)
                problems.append(f"{rel}:{line}: forbidden pattern {pattern.pattern!r}")
    return problems


def local_asset_url(url: str) -> str | None:
    url = url.strip()
    if not url or url.startswith(("#", "mailto:", "tel:", "data:", "javascript:")):
        return None
    if url.startswith("//") or re.match(r"^[a-z][a-z0-9+.-]*:", url, re.IGNORECASE):
        return None
    path = url.split("#", 1)[0].split("?", 1)[0]
    if not ASSET_EXT.search(path):
        return None
    return path


def check_assets(files: list[Path]) -> list[str]:
    problems: list[str] = []
    html_files = [path for path in files if path.suffix.lower() == ".html"]
    for path in html_files:
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in ASSET_ATTR.finditer(text):
            asset = local_asset_url(match.group(1))
            if not asset:
                continue
            if asset.startswith("/"):
                target = ROOT / asset.lstrip("/")
            else:
                target = (path.parent / asset).resolve()
            if not target.is_file():
                line = text.count("\n", 0, match.start()) + 1
                rel = path.relative_to(ROOT)
                problems.append(f"{rel}:{line}: missing local asset {asset}")
    return problems


def main() -> int:
    files = iter_site_files()
    problems = check_forbidden(files) + check_assets(files)
    if problems:
        print("Lead-form check failed:")
        for problem in problems:
            print(f"  {problem}")
        return 1
    print(f"Lead-form check passed ({len(files)} files).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
