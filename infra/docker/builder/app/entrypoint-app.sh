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
# ── INSIDE `APP_DIR`, NOT A SIBLING ─────────────────────────────────────────
# Both bundlers resolve a `dist/` symlink and then refuse to follow it out of
# their root: Turbopack reports "the symlink target leaves the filesystem root"
# (one error per import), and Turbo declines to cache the task at all
# ("tar attempts to write outside of directory"). Mounting the shared output
# under /app satisfies both, because the links then stay inside the tree each
# tool is allowed to read.
OUTPUT_ROOT="${DEP_OUTPUT_ROOT:-/app/dep-output}"
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

# Point of no return: without the builder's shared volume every `@deployer/*` import
# resolves to a `dist/` that this container never builds. Fail with the reason
# rather than a module-resolution error three layers deep.
if [ ! -d "$OUTPUT_ROOT" ]; then
    log "FATAL: no shared output at $OUTPUT_ROOT — is dep-output mounted?"
    log "  Start this service under the dev compose profile, or build the image"
    log "  with APP_DEPS_MODE=baked for a swarm-managed profile."
    exit 1
fi

# ── ORDER IS LOAD-BEARING: WAIT FOR THE BUILDER *BEFORE* LINKING ────────────
# The links below point each package's `dist/` at the shared volume, and that
# volume is only trustworthy once the builder's stamp exists. Linking FIRST
# meant a container that won the cold-start race created an EMPTY `dist/` (the
# `mkdir -p` fallback succeeds on a writable volume), waited for the stamp, and
# then started against a link decided while the directory was empty:
#
#   error: Cannot find module '@deployer/auth/server' from
#   '/app/apps/api/shared/src/config/auth/auth.ts'
#
# It hit whichever container started first, and a `restart` always fixed it —
# so the defect was the ordering, not the dependency.
#
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

# ── 1. Link each pruned package's dist/ at the shared output volume ──────────
# Walks the tree with `find` rather than a fixed-depth glob: the pruned layout is
# NOT uniform — `packages/types` is one level deep and
# `tooling/eslint/plugins/progress` is three. A single-level glob would
# silently miss every package at any other depth.
#
# ── BOTH TREES, NOT JUST `packages` ─────────────────────────────────────────
# `tooling/` holds BUILDABLE packages that applications import at runtime
# (`@deployer/cli-declarative-routing` is in `apps/web`'s devDeps and its
# `dist/index.js` is read by `dr:build`; `@deployer/config-*` and
# `@deployer/pkg-build` are in every app's manifest). Walking only
# `$APP_DIR/packages` left every one of them unlinked, so the app kept the
# `dist/` the IMAGE happened to hold and `apps/web/scripts/entrypoint.dev.ts`
# rebuilt the CLI itself on each start — the "run, then rerun at runtime" this
# volume exists to remove. Measured: the builder publishes
# `packages/@deployer/cli-declarative-routing/dist` into the volume while
# `/app/tooling/bin-declarative-routing/dist` stayed a real, image-owned directory.
#
# The volume path uses each package's NPM NAME (`@deployer/logger`), not its
# directory name (`logger`): the builder publishes by name, so a scoped package
# lands at `packages/@deployer/logger/dist`. Using the directory name would point the
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

    # ── ONLY LINK WHAT THE BUILDER ACTUALLY PUBLISHED ───────────────────────
    # The volume holds one directory per UNION member — the packages the
    # builder was asked to build for the enabled applications. A buildable
    # package that is NOT in that union (`@deployer/dependency-builder`,
    # `@deployer/runthenkill`) has no volume entry and must keep the `dist/`
    # its own image already carries.
    #
    # Without this check the loop below reaches the read-only `mkdir` for those
    # packages and exits FATAL, killing the container over a package nothing
    # here consumes.
    #
    # Presence of `packages/<pkg>` — not of `dist` — is the signal: the builder
    # creates the package directory as part of publishing, so a published
    # package whose `dist` is missing is a genuine misconfiguration and still
    # fails loudly below.
    if [ ! -d "$OUTPUT_ROOT/packages/$pkg" ]; then
        continue
    fi

    # Target FIRST: a symlink into a missing directory is unusable.
    #
    # This is where a MISCONFIGURATION surfaces: the builder published this
    # package, so a missing `dist` means it was planned but its build produced
    # nothing. The volume is mounted read-only, so without this branch the
    # failure would be a bare `mkdir: Read-only file system`, which names
    # neither the package nor the cause.
    if [ ! -d "$target" ]; then
        if ! mkdir -p "$target" 2>/dev/null; then
            log "FATAL: $pkg has no build output at $target"
            log "  The dependency-builder published this package but built nothing."
            log "  Check its build output in the builder's log."
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
done < <(find "$APP_DIR/packages" "$APP_DIR/tooling" \
    -name package.json -not -path '*/node_modules/*' 2>/dev/null |
    sed 's|/package.json$||' | sort -u)

fi # end volume mode

# ── 2b. WAIT FOR ONBOARDING (web only, opt-in) ───────────────────────────────
# `WAIT_FOR_SETUP_URL` names an endpoint that returns 200 once the platform has
# been provisioned (`/setup/health` on the setup app: 503 until the wizard's
# details are persisted, 200 from then on). When set, this app does not start its
# dev server until that gate opens.
#
# ── WHY IN THE ENTRYPOINT AND NOT IN `depends_on` ─────────────────────────
# `depends_on: { setup-dev: service_healthy }` is the obvious expression and it
# does not work: it blocks `docker compose up -d` for the WHOLE stack until a
# human finishes the wizard. Measured — `up -d` timed out after 180s with the
# dependency-builder and bff Healthy and everything after them Waiting, because
# compose waits for every dependency of a selected service before returning,
# whether the service is detached or not. The operator could not even reach the
# wizard through a stack that had not finished coming up.
#
# Waiting HERE instead keeps compose's contract intact (every selected service
# starts) while still holding the dev server back: the container is up, the
# entrypoint observes the gate, and the app's first compile happens after
# onboarding — which is the state a browser arriving at web actually needs.
#
# ── WHY THIS APP IN PARTICULAR ───────────────────────────────────────────
# Before onboarding there is no database and no instance row, so a web server
# that booted first only produced failures: middleware that queries bootstrap
# state, SSR that assumes a configured instance. The wizard UI itself is served
# by the `setup` container (`setup.deployer.localhost` → `http://setup:3016`), so
# holding web back cannot lock the operator out of onboarding.
#
# The wait is BOUNDED and non-fatal. A gate that never opens must not turn into a
# container that appears healthy-but-dead, and a compose stack someone starts to
# look at the frontend should still come up after the timeout with a clear log
# line explaining what it skipped.
if [ -n "${WAIT_FOR_SETUP_URL:-}" ]; then
    setup_deadline=$(( $(date +%s) + ${WAIT_FOR_SETUP_TIMEOUT:-1800} ))
    log "waiting for onboarding to complete: $WAIT_FOR_SETUP_URL"

    while :; do
        # `--spider` sends HEAD and reports only the status, which is all the
        # gate is: 503 while closed, 200 once open. A connection failure (the
        # setup container still booting) reads as "not open yet", not as an
        # error, so it must be treated exactly like a 503.
        if wget --no-verbose --tries=1 --spider "$WAIT_FOR_SETUP_URL" 2>/dev/null; then
            log "onboarding complete — starting"
            break
        fi

        if [ "$(date +%s)" -ge "$setup_deadline" ]; then
            log "TIMED OUT after ${WAIT_FOR_SETUP_TIMEOUT:-1800}s waiting for onboarding;"
            log "  starting anyway. Expect requests to fail until setup is finished at"
            log "  http://setup.deployer.localhost — the app is up, the platform is not."
            break
        fi

        sleep 5
    done
fi

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
