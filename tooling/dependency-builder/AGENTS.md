# AGENTS.md — `tooling/dependency-builder`

Builds the union of internal workspace packages the enabled applications need,
once, and keeps them built while the dev stack runs.

## Scope Rules

Applies to everything under `tooling/dependency-builder/`. The root
[`AGENTS.md`](../../AGENTS.md) and
[`.github/copilot-instructions.md`](../../.github/copilot-instructions.md) still
apply. On conflict, this file wins for this folder only.

## What It Does

```text
turbo prune <app>  ├─ was: one pruned workspace per application
                   └─ is:  one shared union, computed from the manifests
```

This replaces the per-application `prune-*` volumes. Instead of each application
container receiving a pruned copy of the repository, one container computes the
union of what every enabled application needs, builds it through a single Turbo
graph, and publishes the artifacts to a shared volume the applications read.

## Where It Runs

The `dev-dependency-builder` compose profile — `bun run dev:dep-builder`. One
container runs this tool; the applications consume its output through the shared
`dep-output` volume.

| Concern                        | File                                                                     |
| ------------------------------ | ------------------------------------------------------------------------ |
| the tool                       | `tooling/dependency-builder/`                                              |
| its image                      | `infra/docker/builder/dependency-builder/Dockerfile.dependency-builder.dev`    |
| its service                    | `infra/docker/compose/common/dependency-builder/docker-compose.config.dev.yml` |
| the applications' shared image | `infra/docker/builder/app/Dockerfile.app.dev`                                  |
| the applications' entrypoint   | `infra/docker/builder/app/entrypoint-app.sh`                                   |
| the orchestrator               | `infra/docker/compose/docker-compose.dev-dependency-builder.yml`               |

Those decisions — the late `ARG APP`, why the application image does not build,
and why this image is not pruned — are documented in
[`infra/docker/builder/AGENTS.md`](../../docker/builder/AGENTS.md).

## The Closure Rule

```text
closure(app) = reachable(app's internal deps) ∪ root internal devDeps
```

Verified against `turbo prune` for every application — **api 31, setup 29, web
21, doc 8, all exact**. Encoded as tests in
`src/services/union-planner.service.spec.ts`; do not "simplify" the rule without
re-running that comparison.

Two halves are easy to get wrong, both found by a mismatched run first:

1. **Descend INTO a package directory, do not stop at it.**
   `tooling/eslint` is itself a workspace AND contains
   `tooling/eslint/plugins/progress`. Stopping at the first
   `package.json` silently omits the nested one, for every application.
2. **The root manifest's internal devDependencies always belong.**
   `turbo prune` keeps them for every target. This is why `doc` needs
   `@repo/env`: nothing in doc's own closure declares it, but the root does.

The tool's **own** dependencies are added to every union (`SELF_CONTRIBUTOR`), so
it is never the one consumer missing from the graph it computes.

## Invariants That Are Silently Fatal

- **The applications must NOT be in Turbo's build graph.** `turbo watch`
  rebuilds whatever in the graph changes, including the applications that
  DEPEND on a changed package, so the builder ran `api:build`, `web:build` and
  `setup:build` inside its own container:

    ```text
    web:build: $ bun --bun scripts/build.ts
    web:build: error: Unexpected while resolving package 'handlebars'
    web#build:  ERROR  command (/app/apps/web) ... exited (1)
    ```

    `TurboRunner.excludeApplicationsFromGraph` strips `apps/**` from the workspace
    list of the builder's own manifest before any Turbo process starts. A
    `--filter=!./apps/web` does **not** work — filters select which tasks to run,
    but dependents of a changed package still enter the graph. The workspace list
    is the structural lever. Measured: 40 workspaces with 4 applications → 36 with
    0, and a real source edit produced 0 app build lines.

- **Published artifacts must be RESOLVABLE where they land.** A built `.mjs`
  contains bare imports; resolution walks UP from the importing file, so once
  `dist/` is published outside its package the walk starts in a directory
  holding only `dist/`. Every bare import fails:

    ```text
    error: Cannot find module '@repo/type-guards' from
    '/dep-output/packages/@repo/nest-docker/dist/esm/index-b7a21c1e.mjs'
    ```

    `TurboRunner.publishResolutionContext` therefore places, alongside each
    published `dist/`: the package's `package.json` (its `exports` map), a
    `node_modules` link to the package's own tree, and a `src` link. The volume
    root also gets a `node_modules` -> `/app/node_modules` link as a fallback.

    Use `lstatSync` for those existence checks, not `existsSync`: the latter
    follows the link, so a link whose target does not resolve from the current
    container reads as absent and the create throws `EEXIST`.

- **`--cache-dir` must point outside the repository.** A populated Turbo cache
  makes Turbo replay a task by unpacking its tarball into `outputs` — and that
  unpack **replaces each `dist/` symlink with a real directory**, detaching the
  package from the shared volume. Measured: with the repository cache, 4 packages
  replayed and published artifacts dropped from 38 to 0. `watch` accepts
  `--cache-dir` but rejects `--force`, and `--no-cache` is accepted yet ignored,
  so the cache directory is the only lever that works in both modes.

- **`pkg-build` must not `rm -rf` a symlinked `dist`.** It clears the contents
  instead (`tooling/bin-pkg-build/src/services/pkg-builder.service.ts`,
  `buildAll`). Removing the link sends
  build output into the package directory, so nothing reaches the volume.

- **`{"type":"module"}` forbids top-level `await` in the CJS output.** `main.ts`
  uses `void bootstrap()`. A top-level `await` fails the CJS build with
  `"await" can only be used inside an "async" function`.

- **Bun resolves `tsconfig.json` from `$cwd`, not from the entry file.** The
  decorator flags are read from there. Run this tool from its own package
  directory (as the `dev`/`start` scripts do); from anywhere else, nest-commander
  throws `undefined is not an object (evaluating 'descriptor.value')`.
  `--tsconfig-override <abs path>` does NOT fix it; `bun --cwd <pkg>` does.

## Commands

```bash
bun --bun run dev                                   # watch mode
bun --bun run test | type-check | lint | format
bun --bun src/main.ts build -a api -a web --dry-run # log the union and stop
```

Options: `-r/--root <path>` (repository root), `-a/--application <name>`
(repeatable, the workspace name of an ENABLED application), `-o/--output <path>`
(where artifacts are published), `--once` (build once, do not watch),
`--dry-run` (log the union, touch nothing).

`--dry-run` is the safe way to inspect the union: without it, the tool replaces
real `dist/` directories with symlinks into the output root.

In the compose profile the enablement list is `DEP_BUILDER_APPS`, whose default
covers all four applications:

```bash
DEP_BUILDER_APPS="-a api -a web" bun run dev:dep-builder
```

**Enabling an application means adding it there.** A container whose app is not
in the list will not find its packages in the volume and will refuse to start,
naming the first missing package.

## Boundaries

- Never import from `apps/*`. This tool describes the workspace graph; it is not
  part of it. Its only internal dependencies are `@repo/logger` and
  `@repo/type-guards`.
- Never hardcode a package list. Everything comes from the manifests, which is
  what makes "built once" true by construction rather than by maintenance.
