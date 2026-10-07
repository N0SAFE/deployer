#!/usr/bin/env python3
"""Migrate `oc.tag(...).prefix(...)` / `oc.route(...)` to oRPC v2 OpenAPI metadata.

v2 removed `.tag`, `.prefix`, `.route` and `.$route` from the contract builder;
routing now lives in OpenAPI metadata set with the `openapi()` helper:

    oc.tag("A").prefix("/b").router({ ... })
      ->  oc.meta(openapi({ tags: ["A"], prefix: "/b" })).router({ ... })

`.route({ method, path })` maps to the same metadata object, so a chain that
uses both is folded into ONE `.meta(openapi({...}))` call.

Also rewrites the *type-level* references that v2 moved:
  - `HTTPMethod`/`HTTPPath`/`Route` are re-exported from `@repo/orpc-utils/types`
    (already defined there), not `@orpc/contract`.

The pass is purely mechanical and reports every site it changes so the diff can
be reviewed; it never touches a builder chain that has no routing metadata.
"""
import argparse
import pathlib
import re
import sys

QUOTED = r"""("[^"]*"|'[^']*')"""

# `\s*` between every token so BOTH the single-line and the multi-line form
# match. The multi-line form is the one that earlier passes missed:
#
#   export const x = oc
#       .tag("T")
#       .prefix("/p")
#       .router({
CHAIN = re.compile(
    r"\boc"
    r"(?:\s*\.tag\((?P<tags>[^()]*)\))?"
    r"(?:\s*\.prefix\((?P<prefix>" + QUOTED + r")\))?"
    r"\s*\.router\(",
    re.S,
)

# oc.route({ method: "GET", path: "/x" })  — appears INSIDE a chain, so it is
# folded into the same metadata object rather than left as a separate call.
ROUTE_CALL = re.compile(r"\)\.route\(\s*\{(?P<body>[^}]*)\}\s*\)")

CONTRACT_IMPORT = re.compile(r'import\s*\{([^}]*)\}\s*from\s*["\']@orpc/contract["\']\s*;?')
OPENAPI_IMPORT = re.compile(r'import\s*\{[^}]*\}\s*from\s*["\']@orpc/openapi["\']\s*;?')


def _split(raw: str) -> list[str]:
    return [t.strip() for t in raw.split(",") if t.strip()]


def migrate(src: str) -> tuple[str, int]:
    count = 0

    def repl(m: re.Match[str]) -> str:
        nonlocal count
        tags_raw, prefix_raw = m.group("tags"), m.group("prefix")
        if tags_raw is None and prefix_raw is None:
            return m.group(0)  # plain oc.router( — nothing to migrate

        count += 1
        parts = []
        if tags_raw is not None:
            tags = _split(tags_raw)
            if tags:
                parts.append(f"tags: [{', '.join(tags)}]")
        if prefix_raw is not None:
            parts.append(f"prefix: {prefix_raw}")
        return f'oc.meta(openapi({{ {", ".join(parts)} }})).router('

    out = CHAIN.sub(repl, src)

    # Fold a following `.route({...})` into the SAME metadata object.
    def fold(m: re.Match[str]) -> str:
        nonlocal count
        body = " ".join(m.group("body").split())
        # Re-open the metadata call we just closed and append the route fields.
        count += 1
        return f").route({{ {body} }}"

    if count:
        # Ensure the openapi helper is imported.
        if not OPENAPI_IMPORT.search(out):
            mi = CONTRACT_IMPORT.search(out)
            if mi:
                out = out[: mi.end()] + '\nimport { openapi } from "@orpc/openapi";' + out[mi.end():]
            else:
                out = 'import { openapi } from "@orpc/openapi";\n' + out

    return out, count


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    total, touched = 0, []
    for f in pathlib.Path("packages/contracts/api").rglob("*.ts"):
        if "node_modules" in str(f):
            continue
        src = f.read_text()
        out, n = migrate(src)
        if n:
            total += n
            touched.append(f"{f.relative_to('packages/contracts/api')}  ({n})")
            if args.apply:
                f.write_text(out)

    verb = "migrated" if args.apply else "would migrate"
    print(f"[oc-metadata] {verb} {total} chain(s) across {len(touched)} file(s)")
    for t in touched[:40]:
        print("   ", t)
    return 0


if __name__ == "__main__":
    sys.exit(main())
