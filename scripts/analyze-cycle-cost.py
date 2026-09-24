#!/usr/bin/env python3
"""Report the exact SOURCE files that create each cross-group cycle.

A cycle between two planned packages is only as expensive to break as the number
of files that straddle it. This lists them, so the fix can be scoped precisely
instead of assuming the whole module must move.
"""
import os
import re
from collections import defaultdict

ROOT = "apps/api/src"
CORE = os.path.join(ROOT, "core", "modules")

GROUPS = {
    "nodes": "node-state",
    "docker": "docker",
    "swarm": "swarm",
    "ingress": "platform-ingress",
    "mesh": "mesh",
    "supervisors": "supervisors",
    "reachability": "reachability",
    "db-local": "database/local",
}

EXTRA_FILES = {
    "nodes": [
        "setup/repositories/node-config.repository.ts",
        "swarm/repositories/cluster-node.repository.ts",
        "swarm/repositories/cluster-node-inventory.repository.ts",
    ],
}

IMPORT_RE = re.compile(r'from\s+"(@/[^"]+|\.\.?/[^"]+)"')


def iter_ts(directory):
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if d not in ("node_modules", "dist", ".turbo")]
        for f in files:
            if f.endswith(".ts") and ".spec." not in f and ".e2e-" not in f:
                yield os.path.join(root, f)


def resolve(spec, from_file):
    if spec.startswith("@/"):
        base = os.path.normpath(os.path.join(ROOT, spec[2:]))
    elif spec.startswith("."):
        base = os.path.normpath(os.path.join(os.path.dirname(from_file), spec))
    else:
        return None
    for cand in (base + ".ts", os.path.join(base, "index.ts")):
        if os.path.isfile(cand):
            return os.path.relpath(cand, ROOT).replace(os.sep, "/")
    return None


def main():
    members = {}
    for name, d in GROUPS.items():
        full = os.path.join(CORE, d)
        if not os.path.isdir(full):
            continue
        members[name] = {os.path.relpath(p, ROOT).replace(os.sep, "/") for p in iter_ts(full)}
    for rel in EXTRA_FILES.get("nodes", []):
        members["nodes"].add(os.path.normpath(os.path.join("core/modules", rel)).replace(os.sep, "/"))

    owner = {}
    for name, files in members.items():
        for f in files:
            owner[f] = name

    # (srcgroup, dstgroup) -> { srcfile -> set(dstfiles) }
    straddle = defaultdict(lambda: defaultdict(set))
    for name, files in members.items():
        for f in sorted(files):
            full = os.path.join(ROOT, f)
            if not os.path.isfile(full):
                continue
            txt = open(full, encoding="utf-8", errors="replace").read()
            for spec in IMPORT_RE.findall(txt):
                target = resolve(spec, full)
                if target is None:
                    continue
                tgroup = owner.get(target)
                if tgroup is None or tgroup == name:
                    continue
                straddle[(name, tgroup)][f].add(target)

    print("=== straddling files per direction (the cycle cost) ===")
    for (a, b) in sorted(straddle):
        mutual = (b, a) in straddle
        tag = "  <-- CYCLE" if mutual else ""
        print(f"\n{a} -> {b}{tag}")
        for f in sorted(straddle[(a, b)]):
            tgts = sorted(straddle[(a, b)][f])
            print(f"    {f}")
            for t in tgts:
                print(f"        imports {t}")

    print("\n\n=== summary: files to fix per cycle ===")
    seen = set()
    for (a, b) in sorted(straddle):
        if (b, a) in straddle and (b, a) not in seen:
            seen.add((a, b))
            n = len(straddle[(a, b)]) + len(straddle[(b, a)])
            print(f"  {a} <-> {b}: {n} file(s) straddle")


if __name__ == "__main__":
    main()
