#!/usr/bin/env python3
"""File-level dependency analysis for the planned @repo/nest-* extractions.

Module-level imports can be misleading: `node-state.module.ts` importing
`swarm/repositories/x.repository.ts` is a FILE dependency on a repository, not a
module cycle with `swarm.module.ts`. Package extraction cares about files, so
this resolves every import to a real file and reports genuine file-level cycles
between the planned package groups.
"""
import os
import re
import sys

ROOT = "apps/api/src"
CORE = os.path.join(ROOT, "core", "modules")

# group -> directory (relative to CORE)
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

# The repo files that node-state.module.ts pulls in from OTHER groups. These are
# the files that would move into @repo/nest-nodes to make it a real leaf.
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
    """Resolve an import specifier to a path relative to apps/api/src, or None."""
    if spec.startswith("@/"):
        base = os.path.normpath(os.path.join(ROOT, spec[2:]))
    elif spec.startswith("."):
        base = os.path.normpath(os.path.join(os.path.dirname(from_file), spec))
    else:
        return None  # external package
    for cand in (base + ".ts", os.path.join(base, "index.ts")):
        if os.path.isfile(cand):
            return os.path.relpath(cand, ROOT)
    return None


def group_of(rel_path):
    """Which planned package group a src-relative path belongs to."""
    norm = rel_path.replace(os.sep, "/")
    prefix = "core/modules/"
    if not norm.startswith(prefix):
        return None
    rest = norm[len(prefix):]
    for name, d in GROUPS.items():
        if rest.startswith(d + "/"):
            return name
    return None


def main():
    # Build the membership map: group -> set of src-relative files.
    members = {}
    for name, d in GROUPS.items():
        full = os.path.join(CORE, d)
        if not os.path.isdir(full):
            print(f"!! missing dir for {name}: {full}")
            continue
        members[name] = {os.path.relpath(p, ROOT) for p in iter_ts(full)}

    # Pull the cross-group repository files into `nodes`.
    for rel in EXTRA_FILES.get("nodes", []):
        members["nodes"].add(os.path.normpath(os.path.join("core/modules", rel)))

    owner = {}
    for name, files in members.items():
        for f in files:
            owner[f.replace(os.sep, "/")] = name

    # Edges between groups.
    edges = {}
    for name, files in members.items():
        out = {}
        for f in sorted(files):
            full = os.path.join(ROOT, f)
            if not os.path.isfile(full):
                continue
            txt = open(full, encoding="utf-8", errors="replace").read()
            for spec in IMPORT_RE.findall(txt):
                target = resolve(spec, full)
                if target is None:
                    continue
                tkey = target.replace(os.sep, "/")
                tgroup = owner.get(tkey)
                if tgroup is None or tgroup == name:
                    continue
                out.setdefault(tgroup, set()).add(tkey)
        edges[name] = out

    print("=== cross-group edges (file-level, real files only) ===")
    for name in sorted(edges):
        if edges[name]:
            for tgroup in sorted(edges[name]):
                n = len(edges[name][tgroup])
                sample = sorted(edges[name][tgroup])[:2]
                print(f"  {name:13} -> {tgroup:13} ({n} file{'s' if n > 1 else ''})  e.g. {sample[0]}")
        else:
            print(f"  {name:13} -> (none)")

    print("\n=== cycles among groups ===")
    found = False
    names = sorted(edges)
    for a in names:
        for b in edges[a]:
            if b in edges and a in edges.get(b, {}):
                found = True
                print(f"  CYCLE: {a} <-> {b}")
    if not found:
        print("  none")

    print("\n=== extractable order (topological, ignoring cycles) ===")
    remaining = {n: set(edges[n]) & set(names) for n in names}
    order = []
    while remaining:
        ready = sorted(n for n, deps in remaining.items() if not deps)
        if not ready:
            print(f"  STUCK — remaining with cycles: {sorted(remaining)}")
            for n in sorted(remaining):
                print(f"    {n} needs {sorted(remaining[n])}")
            break
        for n in ready:
            order.append(n)
            del remaining[n]
        for deps in remaining.values():
            deps.difference_update(ready)
    for i, n in enumerate(order, 1):
        print(f"  {i}. {n}")


if __name__ == "__main__":
    sys.exit(main())
