#!/usr/bin/env python3
"""Fail if the two `service-surface.ts` copies diverge.

WHY THIS EXISTS
    The service surface cannot live in `@deployer/bff-contracts`: a function returning the
    full service router has an inferred type that exceeds TypeScript's declaration
    serialization limit (TS7056), and that package emits declarations. So the list is
    duplicated into the BFF (which serves it) and the web app (which calls it).

    Duplication without a check is how the two drift, and the drift surfaces as a
    runtime 404 in whichever direction nobody tested. This is the check. It compares the
    copies IGNORING whitespace and comments, because those legitimately differ.

Usage: python3 scripts/check-service-surface-parity.py
Exit:  0 when identical, 1 with a diff otherwise.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

COPIES = [
    ROOT / "apps/api/bff/src/orpc/service-surface.ts",
    ROOT / "apps/web/src/lib/orpc/service-surface.ts",
]


def normalized(path: Path) -> list[str]:
    """The file's significant lines: no comments, no blank lines, no indentation."""
    text = path.read_text()
    text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    lines = (re.sub(r"//.*$", "", line).strip() for line in text.splitlines())
    return [line for line in lines if line]


def main() -> int:
    missing = [str(p.relative_to(ROOT)) for p in COPIES if not p.exists()]
    if missing:
        print("service surface copy missing:")
        for name in missing:
            print(f"  {name}")
        return 1

    a, b = (normalized(p) for p in COPIES)
    if a == b:
        print(f"service surface parity OK ({len(a)} significant lines, {len(COPIES)} copies)")
        return 0

    print("service surface copies DIVERGED — the BFF and the front disagree on the")
    print("public namespaces, which fails at runtime rather than at build time.")
    print()
    for line in sorted(set(a) - set(b)):
        print(f"  only in {COPIES[0].relative_to(ROOT)}: {line}")
    for line in sorted(set(b) - set(a)):
        print(f"  only in {COPIES[1].relative_to(ROOT)}: {line}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
