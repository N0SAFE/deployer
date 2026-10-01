#!/usr/bin/env bash
#
# Application entrypoint, for both dependency modes.
#
#   volume  (compose-managed dev) The `dependency-builder` container owns the
#           internal packages and publishes them to the shared `dep-output`
#           volume. This script links each package's `dist/` at that volume and
#           waits for the builder's first build, so the app never starts against
#           an empty or half-written tree.
#
#   baked   (swarm-managed) The packages are already IN this image. A swarm
#           service cannot be handed a compose volume of prebuilt packages, so
#           the image carries them and this script does nothing but exec.
#
# The mode is baked into the image as `APP_DEPS_MODE`, so a container cannot be
# started in a mode its filesystem does not match.
#
# Each volume-mode step's ORDER is load-bearing, and each was verified in the lab
# (tmp/watch-lab/FINDINGS.md):
#
#   * The volume's target directory is created BEFORE the symlink. A dangling
#     symlink cannot be written through, and `mkdir -p` on it fails with EEXIST.
#   * The link is created AFTER the prune is in place. Linking first means a
#     later copy overwrites the link.
#   * `rm -rf` is applied to the package's `dist/` — never to the volume target.
#     Removing the target destroys the builder's artifacts; removing the link
#     would silently redirect later writes into this container, defeating the
#     shared-output design.
set -euo pipefail

APP_DIR="${APP_DIR:-/app}"
OUTPUT_ROOT="${DEP_OUTPUT_ROOT:-/dep-output}"
DEPS_MODE="${APP_DEPS_MODE:-volume}"

# Which application is this? The image is built per application but SHARED by all
# four, so the identity is not baked in: it is derived from the working
# directory, which the Dockerfile sets to `/app/apps/<name>` (the pruned tree
# keeps the repository layout).
#
# Derived rather than passed, so neither compose nor a swarm service spec has to
# know the name — which matters most in swarm mode, where the spec is built
# programmatically and a missing variable would be silent.
if [ -z "${APP_NAME:-}" ]; then
    APP_NAME=$(basename "${PWD%/}")
fi

log() { printf '[entrypoint:%s] %s\n' "$APP_NAME" "$*"
}

# ── Baked mode: nothing to resolve, nothing to wait for ──────────────────────
# The packages are in the image's own `packages/*/dist`, where Node and Bun find
# them by walking up from the importing file. No volume, so no link and no gate.
if [ "$DEPS_MODE" = "baked" ]; then
    log "baked dependencies — starting directly"
else

# Point of no return: without the builder's shared volume every `@repo/*` import
# resolves to a `dist/` that this container never builds. Fail with the reason
# rather than a module-resolution error three layers deep.
if [ ! -d "$OUTPUT_ROOT" ]; then
    log "FATAL: no shared output at $OUTPUT_ROOT — is dep-output mounted?"
    log "  Start this service under the dev compose profile, or build the image"
    log "  with APP_DEPS_MODE=baked for a swarm-managed profile."
    exit 1
fi

# ── 1. Link each pruned package's dist/ at the shared output volume ──────────
# Walks the tree with `find` rather than a fixed-depth glob: the pruned layout is
# NOT uniform — `packages/types` is one level deep and
# `packages/configs/eslint/plugins/progress` is three. A single-level glob would
# silently miss every package at any other depth.
#
# The volume path uses each package's NPM NAME (`@repo/logger`), not its
# directory name (`logger`): the builder publishes by name, so a scoped package
# lands at `packages/@repo/logger/dist`. Using the directory name would point the
# symlink at a directory nothing ever writes to.
linked=0
while IFS= read -r pkg_path; do
    manifest="$pkg_path/package.json"

    # Packages with no `build` script produce no artifacts to share.
    grep -q '"build"' "$manifest" 2>/dev/null || continue

    pkg=$(jq -r '.name // empty' "$manifest")
    if [ -z "$pkg" ]; then
        log "WARN: no \"name\" in $manifest — skipping"
        continue
    fi

    target="$OUTPUT_ROOT/packages/$pkg/dist"

    # Target FIRST: a symlink into a missing directory is unusable.
    #
    # This is also where a MISCONFIGURATION surfaces. The builder creates a
    # target for every package it builds, so a missing one means it was never
    # asked to build this package — i.e. this application is running but is not
    # in `DEP_BUILDER_APPS`. The volume is mounted read-only, so the failure
    # would otherwise be a bare `mkdir: Read-only file system`, which names
    # neither the package nor the cause.
    if [ ! -d "$target" ]; then
        if ! mkdir -p "$target" 2>/dev/null; then
            log "FATAL: $pkg has no build output at $target"
            log "  The dependency-builder did not build this package."
            log "  Add this application to DEP_BUILDER_APPS, or disable it."
            exit 1
        fi
    fi

    if [ -L "$pkg_path/dist" ]; then
        # Already linked from an earlier start. Verify it still points where we
        # would point it — a stale link (e.g. the package was renamed) would
        # otherwise survive forever.
        current=$(readlink "$pkg_path/dist" 2>/dev/null || true)
        if [ "$current" = "$target" ]; then
            :
        else
            rm -f "$pkg_path/dist"
            ln -s "$target" "$pkg_path/dist"
        fi
    else
        rm -rf "$pkg_path/dist"
        ln -s "$target" "$pkg_path/dist"
    fi

    linked=$((linked + 1))
done < <(find "$APP_DIR/packages" -name package.json -not -path '*/node_modules/*' 2>/dev/null | sed 's|/package.json$||' | sort -u)

log "linked $linked package(s) from $OUTPUT_ROOT"

# ── 1b. Materialize those links for Turbopack ────────────────────────────────
# ── WHY A SYMLINK IS NOT ENOUGH FOR THE WEB APP ──────────────────────────────
# Turbopack REFUSES to resolve a symlink whose real path leaves the project
# root. The links above point at $OUTPUT_ROOT (/dep-output), which is a separate
# volume, so Next's dev server failed every `@repo/ui/<subpath>` import with:
#
#   Symlink [project]/packages/ui/base/dist/development/esm/lib/utils.mjs
#   invalid, points out filesystem root
#   ./apps/web/src/components/loading/AppLoadingScreen.tsx
#
# The dashboard then answered 500 on EVERY page while the API, the ingress and
# the database were all healthy — the failure looked like an app bug rather than
# a build-layout one.
#
# Copying the artifacts in place keeps the single-writer property the symlink
# existed for (the builder still owns and writes the volume; this container only
# reads it) while giving Turbopack real files inside the project tree.
#
# Scoped to the web app because it is the only Turbopack consumer — Vite (setup,
# doc) and tsx (api) follow symlinks normally, and copying for them would double
# the image's disk for no benefit.
if [ "$APP_NAME" = "web" ]; then
    materialized=0
    while IFS= read -r pkg_path; do
        [ -L "$pkg_path/dist" ] || continue
        src=$(readlink "$pkg_path/dist" 2>/dev/null || true)
        if [ -z "$src" ] || [ ! -d "$src" ]; then continue; fi
        rm -f "$pkg_path/dist"
        cp -R "$src" "$pkg_path/dist"
        materialized=$((materialized + 1))
    done < <(find "$APP_DIR/packages" -name package.json -not -path '*/node_modules/*' 2>/dev/null | sed 's|/package.json$||' | sort -u)
    log "materialized $materialized package dist(s) for Turbopack (web app)"
fi

# ── 2. Wait for the builder's first build ────────────────────────────────────
# The gate is the builder's own stamp, written only after a successful build, so
# an absent stamp means the artifacts are not trustworthy yet. Waiting on a real
# artifact rather than on container health avoids the case where the builder is
# "up" but has not finished its first pass.
if [ "${WAIT_FOR_DEPS:-1}" = "1" ]; then
    stamp="$OUTPUT_ROOT/.initial-build-complete"
    deadline=$(( $(date +%s) + ${DEP_WAIT_TIMEOUT:-900} ))

    log "waiting for the dependency-builder's initial build..."
    until [ -f "$stamp" ]; do
        if [ "$(date +%s)" -ge "$deadline" ]; then
            log "TIMED OUT after ${DEP_WAIT_TIMEOUT:-900}s waiting for $stamp"
            # Fail loudly. Starting anyway surfaces as a confusing
            # module-resolution error inside the dev server.
            exit 1
        fi
        sleep 1
    done
    log "dependency-builder's initial build is complete"
fi

fi # end volume mode

# ── 3. Start this application's dev server ───────────────────────────────────
# The Dockerfile already set the working directory to the application's own
# package directory, and Bun resolves `tsconfig.json` from `$cwd` — so the app's
# aliases and decorators are read from there without a `cd` that could drift.
#
# The image's CMD is authoritative — it is the per-app dev command. The
# environment fallback exists only for a `docker run` with no command.
if [ "$#" -gt 0 ]; then
    log "starting: $*"
    exec "$@"
fi

log "starting: ${APP_DEV_CMD:-bun run dev}"
exec ${APP_DEV_CMD:-bun run dev}
