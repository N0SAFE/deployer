#!/usr/bin/env python3
"""Generate the BFF's typed delegation layer.

WHY THIS EXISTS
    The BFF is the only public HTTP surface, so every procedure the front calls must be
    OWNED by the BFF. That is 315 procedures across 18 namespaces. Hand-writing them is
    boilerplate; generating them is mechanical, and the result is type-checked.

WHY THIS IS NOT REQUEST FORWARDING
    A delegated handler calls the owning service through its TYPED CLIENT, with the input
    the contract declares and the output the contract declares. Nothing about the caller's
    HTTP request travels: no path, no query string, no body stream, no response headers.
    The BFF is a CLIENT of the service — which is what lets an orchestrator call three of
    them and join the answers, and what the deleted proxy middleware could not do.

WHY THE CLIENT IS BOUND TO THE NAMESPACE, NOT THE SERVICE
    Each controller binds its OWN namespace contract:

        this.clients.for("project", projectContract)

    ...rather than the service's combined contract. `projectContract` and `serviceContract`
    both declare `list`, `findById`, `create`, `update` and `delete`; binding the combined
    one would put each of those names on two namespaces at once, so the combined client
    omits them from its root type and `this.client.list(...)` would not compile. Binding
    the namespace keeps every call unambiguous by construction, with no aliasing rules to
    remember.

WHY NO CASTS ARE NEEDED
    `@Implement(<contract>.<path>)` declares the route, and `this.client.<path>(input)`
    calls it. Both are derived from the same dotted path, so they cannot disagree — which
    is the property a hand-written mapping loses first.

HOW THE WALK WORKS
    A contract constant takes one of THREE shapes, and each needs different handling:

        single   `export const dockerEntityContract = ...build()`
                 a PROCEDURE. Emitting it as a leaf is correct; descending loses it.
        map      `export const githubAppContract = { issue: ..., pr: ... }`
                 a namespace of procedures, addressed with a prefix.
        router   `export const dockerContract = oc.router({ containers: ... })`
                 a namespace; descend, resolving aliases first.

    Aliases matter: `export const githubCodeProviderContract = githubAppContract;` declares
    nothing itself, so its KIND must be read off the resolved constant. Skipping that is
    what made the `providers` namespace emit 8 procedures instead of 33.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "packages/contracts"
OUT = ROOT / "apps/api/bff/src/modules/delegation/generated"

# (namespace, contract package, top-level const, owning service, import specifier)
TARGETS: list[tuple[str, str, str, str, str]] = [
    ("user", "identity", "userContract", "identity", "@deployer/identity-contracts"),
    ("push", "identity", "pushContract", "identity", "@deployer/identity-contracts"),
    ("analytics", "identity", "analyticsContract", "identity", "@deployer/identity-contracts"),
    ("project", "project", "projectContract", "project", "@deployer/project-contracts"),
    ("service", "project", "serviceContract", "project", "@deployer/project-contracts"),
    ("domain", "project", "domainContract", "project", "@deployer/project-contracts"),
    ("servicePreviewTopology", "project", "servicePreviewTopologyContract", "project", "@deployer/project-contracts"),
    ("deployment", "runtime", "deploymentContract", "runtime", "@deployer/runtime-contracts"),
    ("docker", "runtime", "dockerContract", "runtime", "@deployer/runtime-contracts"),
    ("cluster", "fleet", "clusterContract", "fleet", "@deployer/fleet-contracts"),
    ("nodes", "fleet", "nodesContract", "fleet", "@deployer/fleet-contracts"),
    ("providers", "fleet", "providersContract", "fleet", "@deployer/fleet-contracts"),
    ("providerSchema", "fleet", "providerSchemaContract", "fleet", "@deployer/fleet-contracts"),
    ("reachability", "fleet", "reachabilityContract", "fleet", "@deployer/fleet-contracts"),
    ("mesh", "fleet", "meshContract", "fleet", "@deployer/fleet-contracts"),
    ("platform", "fleet", "platformContract", "fleet", "@deployer/fleet-contracts"),
    ("meshResource", "fleet", "meshBaseResourceContract", "fleet", "@deployer/fleet-contracts"),
    ("health", "health", "healthContract", "health", "@deployer/health-contracts"),
]


def declaring_files(pkg_dir: Path) -> dict[str, Path]:
    """Every `export const XContract = ...` in the package, mapped to its file."""
    found: dict[str, Path] = {}
    for path in sorted(pkg_dir.rglob("*.ts")):
        if "/dist/" in str(path) or "/node_modules/" in str(path):
            continue
        for m in re.finditer(r"export const (\w+Contract)\s*=", path.read_text(errors="replace")):
            found.setdefault(m.group(1), path)
    return found


def resolve_alias(files: dict[str, Path], const: str) -> str:
    """Follow `X = Y;` aliases to the constant that actually declares the shape.

    An alias declares nothing itself, so `kind()` reads it as `single` (a procedure). For
    `export const githubCodeProviderContract = githubAppContract;` the target is a MAP, so
    reading the kind off the DECLARED name is what flattened `providers` to 8 instead of 33.
    """
    seen: set[str] = set()
    current = const
    while current not in seen:
        seen.add(current)
        path = files.get(current)
        if path is None:
            return current
        m = re.search(
            rf"export const {current}\s*=\s*([\w.]+)\s*;", path.read_text(errors="replace")
        )
        if m is None:
            return current
        target = m.group(1).split(".")[-1]
        if target not in files:
            return current
        current = target
    return current


def kind(path: Path, const: str) -> str:
    """`router` | `map` | `single` — how the constant's procedures are addressed."""
    m = re.search(
        rf"export const {const}\s*=\s*([\s\S]{{0,200}})", path.read_text(errors="replace")
    )
    if m is None:
        return "single"
    head = m.group(1)
    if ".router(" in head:
        return "router"
    if head.lstrip().startswith("{"):
        return "map"
    return "single"


def brace_body(text: str, open_index: int) -> str:
    """The text between the brace at `open_index` and its matching close."""
    depth = 0
    for i in range(open_index, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[open_index + 1 : i]
    return ""


def pairs(path: Path, const: str, opener: str) -> list[tuple[str, str]]:
    """`key: value` pairs from `const = <opener> { ... }`, in source order."""
    text = path.read_text(errors="replace")
    m = re.search(rf"export const {const}\s*=\s*{opener}", text)
    if m is None:
        return []
    brace = text.find("{", m.end() - 1)
    if brace == -1:
        return []

    out: list[tuple[str, str]] = []
    for line in brace_body(text, brace).splitlines():
        s = line.strip()
        if not s or s.startswith(("//", "/*", "*", "}")):
            continue
        km = re.match(r"^(\w+)\s*:\s*([\w.]+)\s*,?\s*$", s)
        if km:
            out.append((km.group(1), km.group(2)))
    return out


def leaves(
    files: dict[str, Path], const: str, prefix: list[str], seen: set[str]
) -> list[tuple[str, str]]:
    """Flatten a router tree into (dotted path, contract expression) leaves.

    The three cases are documented in the module docstring; treating `single` as anything
    other than a leaf, or failing to resolve an alias before reading the kind, is what
    produced wrong output on every earlier attempt.
    """
    if const in seen:
        # A router referencing a sub-router already walked must not be expanded twice:
        # that emits duplicate methods for the same procedure.
        return []
    seen.add(const)

    decl = files.get(const)
    if decl is None:
        return []

    how = kind(decl, const)
    if how == "single":
        return [(".".join(prefix), const)]
    if how == "map":
        return [
            (".".join([*prefix, key]), const)
            for key, _value in pairs(decl, const, r"\{")
        ]

    out: list[tuple[str, str]] = []
    for key, value in pairs(decl, const, r"oc[\s\S]{0,400}?\.router"):
        target = resolve_alias(files, value)
        sub_path = files.get(target)
        path = ".".join([*prefix, key])

        if sub_path is not None and kind(sub_path, target) != "single":
            # Descend to ENUMERATE the children, but keep every emitted expression rooted
            # at the NAMESPACE constant. A router key is part of that router's own type, so
            # `dockerContract.containers.actions` resolves with the single import the header
            # makes. Expressing it as `dockerContainerActionsContract` instead names a
            # constant no barrel re-exports — the error this replaces.
            children = leaves(files, target, [*prefix, key], seen | {const})
            out.extend((child_path, const) for child_path, _ in children)
        else:
            out.append((path, const))
    return out


def procedures(pkg_dir: Path, const: str) -> list[tuple[str, str]]:
    """Every (path relative to the namespace, contract expression) the namespace exposes.

    The path is RELATIVE because both call sites need the namespace stripped:

        @Implement(dockerContract.containers.list)   <- the route it declares
        this.client.containers.list(input)            <- the client's path to it
    """
    files = declaring_files(pkg_dir)
    target = resolve_alias(files, const)
    decl = files.get(target)
    if decl is None:
        return []

    how = kind(decl, target)
    if how == "single":
        # One procedure, named after the namespace; the contract IS the procedure.
        return [(target.replace("Contract", ""), const)]
    if how == "map":
        return pairs(decl, target, r"\{")

    out: list[tuple[str, str]] = []
    for key, value in pairs(decl, target, r"oc[\s\S]{0,400}?\.router"):
        sub = resolve_alias(files, value)
        sub_path = files.get(sub)
        if sub_path is not None and kind(sub_path, sub) != "single":
            # Descend to enumerate, then ROOT every expression at the namespace constant:
            # `dockerContract.containers.actions` resolves through the one import the header
            # makes, whereas naming the sub-constant requires importing something no barrel
            # re-exports.
            children = leaves(files, sub, [key], set())
            out.extend((child_path, f"{const}.{child_path}") for child_path, _ in children)
        else:
            out.append((key, f"{const}.{key}"))
    return out


HEADER = '''/**
 * GENERATED — the `{ns}` surface, delegated to `{service}`.
 *
 * Every method here is a CALL ON A TYPED CLIENT, not a relayed request: the input the
 * handler receives is the one the contract declares, and the client accepts exactly that
 * type. The BFF is a CLIENT of the service — which is what lets the orchestrators call
 * several and join the answers, and what the removed proxy middleware could not do,
 * because it relayed bytes it never parsed.
 *
 * ── WHY THERE IS NO `requireAuth()` HERE ────────────────────────────────────
 * Authorization is a property of the PROCEDURE, and the service enforces it on the leg it
 * receives (it applies `requireAuth()`, `requireMesh()` and role gates to the procedures
 * that need them). Re-applying a blanket session requirement at the BFF would BREAK the
 * procedures that are legitimately public — the health probes, the mesh endpoints, the
 * setup surface — and would put one policy in two places, where the copy that drifts is
 * the one nobody reads. The caller's credentials still travel (see `service-auth-context`),
 * so the service decides with the real session in hand.
 *
 * ── WHY THE CLIENT BINDS THE NAMESPACE CONTRACT ─────────────────────────────
 * `clients.for(service, <namespaceContract>)` — not the service's combined contract. The
 * combined one puts `list`/`findById`/`create`/`update`/`delete` on two namespaces at once
 * (project and service both declare them), so its client omits those from the root type and
 * `this.client.list(...)` would not compile. Binding the namespace keeps every call
 * unambiguous by construction, with no aliasing rules to remember.
 *
 * Regenerate with `scripts/gen-bff-delegation.py`; do not hand-edit.
 */

import {{ Controller }} from "@nestjs/common";
import {{ Implement }} from "@orpc/nest";
import {{ implement }} from "@orpc/server";

import {{ {const} }} from "{import_pkg}";

import {{ ServiceClientRegistry }} from "../../../clients/service-registry";

@Controller()
export class {klass} {{
\tconstructor(private readonly clients: ServiceClientRegistry) {{}}

\t/** The typed client for the NAMESPACE this controller serves. */
\tprivate get client() {{
\t\treturn this.clients.for("{service}", {const});
\t}}
'''


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0

    for ns, pkg_name, const, service, import_pkg in TARGETS:
        # The constants this package declares, so the emitted imports can be derived from
        # what the body references. `declaring_files` is the same helper `procedures()`
        # uses — one source of truth for "which constants exist here".
        files = declaring_files(CONTRACTS / pkg_name)

        procs = procedures(CONTRACTS / pkg_name, const)
        if not procs:
            print(f"  SKIP {ns}: no procedures found for {const}")
            continue

        body = HEADER.format(
            ns=ns,
            service=service,
            const=const,
            import_pkg=import_pkg,
            klass=ns[0].upper() + ns[1:] + "DelegationController",
        )

        seen_methods: set[str] = set()
        for dotted, expr in procs:
            method = dotted.replace(".", "_")
            if method in seen_methods:
                continue
            seen_methods.add(method)
            # ── WHY THE CALL IS NOT ALWAYS `this.client.<dotted>` ────────────────
            # When the contract IS the procedure (`meshBaseResourceContract` is a
            # single `.build()`, not a router), the bound client has NO key for it:
            # the client itself is the procedure. Emitting `this.client.meshBaseResource`
            # then names a property that does not exist. `kind()` is what distinguishes
            # the two, and it is the same test the walk already uses.
            # ── WHAT DECIDES THE CALL SHAPE ──────────────────────────────────
            # The client is bound to the NAMESPACE (`const`), so its keys are that
            # router's names — regardless of whether an individual procedure came from
            # a nested constant. Only when the NAMESPACE ITSELF is a single procedure
            # (`meshBaseResourceContract` is one `.build()`) is the client the procedure.
            # Asking about the expression's own constant instead made every procedure of
            # a namespace-backed controller emit `this.client(input)` — one call shape for
            # fifteen different procedures.
            namespaced = kind(files.get(const), const) != "single"
            callee = f"this.client.{dotted}" if namespaced else "this.client"
            body += (
                f"\n\t@Implement({expr})\n"
                f"\t{method}() {{\n"
                f"\t\treturn implement({expr}).handler(({{ input }}) => {callee}(input));\n"
                f"\t}}\n"
            )

        body += "}\n"

        # ── WHY THE IMPORTS ARE DERIVED FROM THE BODY ────────────────────────────
        # A namespace's procedures can live on OTHER constants in the same package:
        # `dockerContract.containers.list` IS `dockerContainersContract.list`, and the
        # expression the generator emits names the latter. Each such constant must be
        # imported, or TypeScript reports "Cannot find name".
        #
        # Reading them OFF THE BODY keeps the import list in step with the calls it
        # serves: a constant is imported exactly when the emitted code mentions it, so
        # the two cannot drift.
        referenced = sorted(
            c
            for c in files
            if c != const and re.search(rf"\b{re.escape(c)}\b", body)
        )
        if referenced:
            marker = f'import {{ {const} }} from "{import_pkg}";'
            extra = "\n".join(
                f'import {{ {c} }} from "{import_pkg}";' for c in referenced
            )
            body = body.replace(marker, marker + "\n" + extra, 1)

        (OUT / f"{ns}.delegation.ts").write_text(body)
        print(f"  {ns:24s} {len(seen_methods):4d} procedures -> {ns}.delegation.ts")
        total += len(seen_methods)

    print(f"\n{total} procedures generated into {OUT.relative_to(ROOT)}")
    if total < 300:
        print("WARNING: fewer than 300 procedures — the walk is probably missing a case")
        sys.exit(1)


if __name__ == "__main__":
    main()
