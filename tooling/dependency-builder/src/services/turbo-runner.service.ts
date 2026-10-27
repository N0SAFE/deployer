import { spawn } from 'node:child_process'
import {
    copyFileSync,
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    rmSync,
    symlinkSync,
    lstatSync,
    readFileSync,
    writeFileSync,
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

import { Injectable } from '@nestjs/common'

import type { UnionMember } from '../schemas'
import { BuildFailedError } from '../errors'
import { scopedLogger } from '../logger'

/**
 * Where built artifacts are published for the application containers.
 *
 * ── INSIDE THE WORKSPACE ROOT, AND THAT IS LOAD-BEARING ─────────────────
 * This path must resolve BELOW the repository root (`/app` in a container).
 * Turbo refuses to package a cache entry whose declared `outputs` resolve
 * outside the workspace root, and says so once per package:
 *
 *     WARNING  tar attempts to write outside of directory:
 *              /dep-output/packages/@deployer/pkg-build/dist
 *
 * The result is not a partial cache but NO cache: measured 2 entries written for
 * 38 packages, so every run rebuilt everything and `cache hit` never appeared.
 *
 * The `dist/` symlinks this class creates are what make that happen — each one
 * points at this root, and Turbo follows it to decide where the output lives.
 * Pointing the root at `/app/dep-output` instead removed every warning and
 * produced `Cached: 1 cached, 1 total >>> FULL TURBO` on the second run.
 *
 * It was `/dep-output` (a SIBLING of `/app`), which is exactly the shape Turbo
 * rejects. Compose must mount the shared volume at this same path.
 */
export const DEFAULT_OUTPUT_ROOT = '/app/dep-output'

/**
 * Turbo's cache directory, as a child of the output root.
 *
 * Deliberately not the repository's `.turbo/cache`, so a build never unpacks
 * into the same tree the editor and the dev server are reading.
 *
 * ── WHERE IT ACTUALLY LIVES ─────────────────────────────────────────────
 * The image's cache when one was baked ({@link BAKED_CACHE_DIR}), so the runtime
 * REUSES builds the Dockerfile already paid for. The volume is only the fallback
 * for a host run, where no image was involved.
 *
 * ── WHAT THE CACHE MUST NOT DO ─────────────────────────────────────────
 * Turbo's restore follows a symlinked `outputs` entry rather than replacing it:
 * verified that a `dist/` symlinked into the shared volume receives the restored
 * files THROUGH the link and stays a link. So a cache hit publishes artifacts
 * instead of detaching the package — which is what makes a warm cache safe here.
 */
export function cacheDirFor(outputRoot: string): string {
    // ── PREFER THE CACHE THE IMAGE BUILT ────────────────────────────────────
    // Present from the first container start, and warm with every internal
    // package the Dockerfile built. Falling back to the volume keeps the tool
    // usable on a host, where no image was involved and `/app` does not exist.
    if (existsSync(BAKED_CACHE_DIR)) return BAKED_CACHE_DIR
    return join(outputRoot, '.turbo-cache')
}

/** Written once the first build succeeds; the applications gate on it. */
export const BUILD_MARKER = '.initial-build-complete'

/**
 * Turbo's cache directory as BAKED INTO THE IMAGE by the Dockerfile.
 *
 * ── WHY THE CACHE IS BAKED, NOT CREATED AT RUNTIME ───────────────────────
 * The Dockerfile builds every internal package, so this directory is already
 * populated before the container starts. Reusing it saves rebuilding whatever
 * the volume does not already hold.
 *
 * ── WHY IT IS NOT ON THE OUTPUT VOLUME ──────────────────────────────────
 * {@link cacheDirFor} originally returned a path under `outputRoot`, which is a
 * freshly-created volume on a first run — and therefore EMPTY. A cache that
 * does not exist cannot be hit.
 *
 * ── WHY IT IS OUTSIDE `/app` ────────────────────────────────────────────
 * `develop.watch` syncs the HOST tree into `/app`, and a directory under `/app`
 * is therefore subject to that sync — a path the host does not have is one the
 * sync may remove. `/opt` is outside the synced tree, so the baked cache is
 * untouched for the life of the container.
 *
 * Verified that a cache seeded WITHOUT `.env` is still reused WITH `.env`
 * loaded (`FULL TURBO`), so the image-build and runtime environments do not
 * invalidate each other's entries.
 */
export const BAKED_CACHE_DIR = '/opt/turbo-cache'

/**
 * Points each union package's `dist/` at the shared output volume, builds, then
 * watches.
 *
 * The symlink is what lets an application container consume artifacts this
 * container produced without sharing a workspace: the application's own
 * `packages/<pkg>/dist` points at the same volume path, and the link is
 * resolved through the shared volume.
 */
@Injectable()
export class TurboRunner {
    private readonly logger = scopedLogger(TurboRunner.name)

    /**
     * Link every union member's `dist/` into the shared output volume.
     *
     * Ordering, each step verified and each silently fatal if violated:
     *  - the volume's target directory must exist FIRST; a dangling symlink
     *    cannot be written through, and `mkdir -p` on it fails with EEXIST
     *  - the existing `dist/` is removed only when it is not already the link
     *  - `rm -rf` is applied to the TARGET, never to the symlink, or the link is
     *    destroyed and later writes land in the package directory instead
     *
     * @returns `true` when EVERY union member already had published artifacts —
     *   which is the case on a first run from the baked image, where the
     *   Dockerfile built them. The caller uses it to skip a build that would be
     *   entirely a cache hit.
     */
    linkOutputs(
        root: string,
        union: readonly UnionMember[],
        outputRoot: string
    ): boolean {
        // Refuse before touching any `dist/`. On the host this root is not
        // creatable without root, and replacing real build output with symlinks
        // into a directory that does not exist would leave the repository broken.
        // In the container the root is a mounted volume and already exists.
        mkdirSync(outputRoot, { recursive: true })

        let allPublished = true

        for (const member of union) {
            const pkgPath = join(root, member.dir)

            if (!existsSync(join(pkgPath, 'package.json'))) {
                this.logger.warn(`skip (not on disk): ${member.name}`)
                continue
            }

            if (!this.hasBuildScript(pkgPath)) {
                this.logger.info(`skip (no build script): ${member.name}`)
                continue
            }

            const target = join(outputRoot, 'packages', member.name, 'dist')
            mkdirSync(target, { recursive: true })

            const link = join(pkgPath, 'dist')
            const existing = lstatSync(link, { throwIfNoEntry: false })

            // ── PRESERVE AN IMAGE-BUILT `dist` ─────────────────────────────────
            // The Dockerfile builds every internal package, so on the FIRST run
            // `dist/` is a real directory holding finished output. Removing it
            // would discard work the image already did and force a rebuild at
            // exactly the moment the operator is waiting on the stack.
            //
            // Copying it into the volume first makes the image's build the only
            // one: the artifacts are published, the symlink is created over the
            // now-redundant directory, and no build is needed at all.
            //
            // Only into an EMPTY target, so a re-run never overwrites artifacts
            // a previous run published (the volume outlives the container).
            if (
                existing?.isDirectory() === true &&
                !existing.isSymbolicLink() &&
                this.isDirEmpty(target)
            ) {
                cpSync(link, target, { recursive: true })
                this.logger.info(
                    `adopted image-built output for ${member.name} into the volume`
                )
            }

            // Judged AFTER the adoption above, which is what makes a first run
            // from the baked image report COMPLETE: the image's output moved into
            // the volume, so nothing is left to build.
            if (this.isDirEmpty(target)) allPublished = false

            if (existing?.isSymbolicLink() || existing?.isDirectory()) {
                rmSync(link, { recursive: true, force: true })
            }
            mkdirSync(dirname(link), { recursive: true })
            symlinkSync(target, link)

            this.logger.info(`linked ${member.dir}/dist -> ${target}`)
        }

        this.publishResolutionContext(root, union, outputRoot)

        return allPublished
    }

    /**
     * Make the published artifacts RESOLVABLE from where they now live.
     *
     * A package's built `.mjs` contains bare imports (`@deployer/type-guards`,
     * `rxjs`, `react`). Node and Bun resolve those by walking UP from the
     * importing file, so once `dist/` is published outside its package the walk
     * starts at `<outputRoot>/packages/<name>/` — which holds only `dist/`.
     * Every bare import then fails:
     *
     *     error: Cannot find module '@deployer/type-guards' from
     *     '/dep-output/packages/@deployer/nest-docker/dist/esm/index-b7a21c1e.mjs'
     *
     * Verified in the running stack: symlinked `dist/` gave exactly that error
     * for `@deployer/nest-docker`, `@deployer/orpc-utils` and `@deployer/ui`, and copying
     * `package.json` next to the published `dist/` plus a `node_modules`
     * symlink at the volume root made all three resolve.
     *
     * Three things are therefore placed alongside each published package:
     *
     *  - `package.json`, for the `exports` map that maps `./dist/esm/*.mjs`
     *    subpaths onto the files, and for the package's `name`
     *  - `node_modules` -> the package's own tree, so its declared dependencies
     *    resolve. A RELATIVE symlink, resolved by the kernel against the
     *    symlink's own directory: each container follows it to its OWN copy, so
     *    the one volume entry serves all four applications.
     *  - `src` -> the package's sources, for the same reason and so source maps
     *    and editors keep working
     *
     * Only packages with a build script are published, matching {@link linkOutputs}.
     */
    private publishResolutionContext(
        root: string,
        union: readonly UnionMember[],
        outputRoot: string
    ): void {
        for (const member of union) {
            const pkgPath = join(root, member.dir)
            if (!existsSync(join(pkgPath, 'package.json'))) continue
            if (!this.hasBuildScript(pkgPath)) continue

            const published = join(outputRoot, 'packages', member.name)
            mkdirSync(published, { recursive: true })

            // `package.json` — the exports map lives here. Copied, not linked,
            // so a running container never sees it change mid-read.
            copyFileSync(
                join(pkgPath, 'package.json'),
                join(published, 'package.json')
            )

            // `node_modules` and `src` — relative links into the live package
            // directory, so the application resolves its own dependencies and
            // picks up source edits.
            for (const name of ['node_modules', 'src'] as const) {
                const from = join(pkgPath, name)
                if (!existsSync(from)) continue

                const at = join(published, name)
                const existing = lstatSync(at, { throwIfNoEntry: false })
                if (existing?.isSymbolicLink() || existing?.isDirectory()) {
                    rmSync(at, { recursive: true, force: true })
                }

                // Relative from the published directory: a relative link is
                // resolved by the kernel against the symlink's own directory, so
                // each container follows it into its OWN tree.
                const linkTarget = relative(dirname(at), from)
                    .split(sep)
                    .join('/')
                symlinkSync(linkTarget, at)
            }
        }

        // The volume root gets a `node_modules` too. A published file that
        // imports something not present in its own package's tree falls back to
        // this one, which is the application's full installed tree.
        //
        // `lstatSync`, not `existsSync`: the latter FOLLOWS the link, so a
        // symlink whose target does not resolve from here (this runs on the host
        // too, where `/app` does not exist) reads as absent and the create below
        // throws EEXIST.
        const volumeNodeModules = join(outputRoot, 'node_modules')
        const volumeEntry = lstatSync(volumeNodeModules, {
            throwIfNoEntry: false,
        })
        if (volumeEntry === undefined) {
            symlinkSync('/app/node_modules', volumeNodeModules)
        }
    }

    /** Does this package declare a `build` script? */
    private hasBuildScript(pkgPath: string): boolean {
        try {
            const raw = JSON.parse(
                readFileSync(join(pkgPath, 'package.json'), 'utf8')
            ) as { scripts?: Record<string, string> }
            return typeof raw.scripts?.build === 'string'
        } catch {
            return false
        }
    }

    /**
     * Is `dir` empty?
     *
     * Used to decide whether an image-built `dist` may be copied over a
     * published one: a NON-empty target means a previous run already published
     * artifacts into this volume, and those must not be overwritten by an older
     * image's output.
     *
     * A directory that cannot be read counts as non-empty, so the copy is
     * skipped rather than attempted on a wrong guess.
     */
    private isDirEmpty(dir: string): boolean {
        try {
            return readdirSync(dir).length === 0
        } catch {
            return false
        }
    }

    /**
     * Run the union's build once.
     *
     * `PKG_BUILD_KEEP_DIST=1` is set by {@link run}; it must also be declared in
     * `turbo.json`'s `passThroughEnv`, because Turbo defaults to strict env mode
     * and strips variables it does not know.
     */
    async buildOnce(
        root: string,
        union: readonly UnionMember[],
        cacheDir: string
    ): Promise<void> {
        const args = [
            'run',
            'build',
            ...this.cacheFlags(cacheDir),
            ...this.scopeFlags(),
        ]
        this.logger.info(`building the union: turbo ${args.join(' ')}`)

        const code = await this.run(root, args)
        if (code !== 0) throw new BuildFailedError(args, code)
    }

    /**
     * Remove the applications from Turbo's workspace graph.
     *
     * THIS IS WHY THE BUILDER MUST NOT SHIP THE APPS' WORKSPACE GLOB. Turbo
     * discovers workspaces from the root manifest, and `turbo watch` (unlike
     * `turbo run`) rebuilds whatever in the graph changes. With `apps/**`
     * present, a package rebuild pulls in the applications that DEPEND on it and
     * `api:build` / `web:build` / `setup:build` run inside this container:
     *
     *     web:build: $ bun --bun scripts/build.ts
     *     web:build: error: Unexpected while resolving package 'handlebars'
     *     web#build:  ERROR  command (/app/apps/web) ... exited (1)
     *
     * Measured on the running stack: 40 workspaces (4 of them applications) and
     * app build lines appearing only AFTER `entering watch mode`. Removing
     * `apps/**` left 36 workspaces, zero applications, and zero app build lines
     * across a real source edit.
     *
     * A `--filter=!./apps/api` does NOT fix this — filters select which tasks to
     * RUN, but dependents of a changed package still enter the graph. The
     * workspace list is the structural lever.
     *
     * The edit is to THIS CONTAINER's manifest only: the builder has its own copy
     * of the repository, and writing it there cannot affect the host or the
     * application containers.
     *
     * ── WHY THIS IS SAFE FOR DISCOVERY ──────────────────────────────────────
     * `WorkspaceScanner` reads the SAME `workspaces.packages` list to decide
     * where workspaces live, so stripping `apps/**` looks like it would make the
     * applications undiscoverable — and it did: a build that applied this edit
     * BEFORE discovery resolved `COMPOSE_PROFILES=all` to nothing and died with
     * `Workspace "(none)" is not part of the repository`.
     *
     * The ordering here is what makes it safe: discovery runs BEFORE this is
     * called, and the scan is cached per root. The scanner also treats the
     * conventional trees as always-scanned, so discovery no longer depends on
     * this list at all — see `WorkspaceScanner.workspaceRoots`.
     *
     * ── WHY IT IS PUBLIC, AND WHY IT RUNS EXACTLY ONCE ──────────────────────
     * This used to be called twice: once from `buildOnce`, and again from
     * `watch`. On a cold stack the two runs are MUTUALLY EXCLUSIVE — the initial
     * build is skipped when the image already published everything — so on a
     * cold start the only call was `watch`'s, which happens AFTER the build
     * marker is written. The applications were therefore already compiling when
     * the first call rewrote the manifest.
     *
     * That rewrite is not cosmetic: `package.json` is part of Turbo's global
     * hash, so changing it after the marker invalidated EVERY entry the image
     * had baked and the watch phase rebuilt all 40 packages from scratch, into
     * the same volume the applications were resolving through:
     *
     *   initial build complete (...)            ← gate opens, apps start
     *   excluded applications from the build graph: apps/**
     *   entering watch mode
     *   · Running build in 40 packages
     *   @deployer/pkg-build:build: cache miss, executing 9f4839ced0cfb079
     *
     * The apps then failed with `Module not found` for eight packages and a
     * Turbopack error naming a file that existed:
     *
     *   Path packages/transport/orpc/dist/esm/index.mjs could not be resolved
     *   because a component does not exist
     *
     * Moving the call to a single explicit step BEFORE the build makes the
     * manifest constant for the rest of the container's life: `buildOnce` and
     * `watch` now see identical workspace sets, so watch starts warm instead of
     * redoing the build, and nothing rewrites the tree under a compiling app.
     */
    excludeApplicationsFromGraph(root: string): void {
        const manifestPath = join(root, 'package.json')

        let raw: {
            workspaces?: { packages?: string[] } | string[]
        }
        try {
            raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof raw
        } catch {
            this.logger.warn(
                `unreadable ${manifestPath}; the graph keeps its apps`
            )
            return
        }

        const workspaces = raw.workspaces
        const list =
            workspaces === undefined
                ? undefined
                : Array.isArray(workspaces)
                  ? workspaces
                  : workspaces.packages

        if (list === undefined) {
            this.logger.warn(`no workspaces list in ${manifestPath}`)
            return
        }

        // Only `apps/**`-style entries: `packages/**` and `tooling/**` must
        // stay, because the union is built from them.
        const kept = list.filter((entry) => !entry.startsWith('apps'))
        if (kept.length === list.length) return // already excluded

        if (Array.isArray(workspaces)) {
            raw.workspaces = kept
        } else if (workspaces !== undefined) {
            workspaces.packages = kept
        }

        writeFileSync(manifestPath, `${JSON.stringify(raw, null, 4)}\n`)
        this.logger.info(
            `excluded applications from the build graph: ${list
                .filter((entry) => entry.startsWith('apps'))
                .join(', ')}`
        )
    }

    /**
     * Enter Turbo watch mode. Does not return while healthy.
     *
     * One watcher for the whole union means a change to a shared package
     * rebuilds it once, and every application consuming it sees the new output
     * through the shared volume.
     */
    async watch(
        root: string,
        union: readonly UnionMember[],
        cacheDir: string
    ): Promise<never> {
        const args = [
            'watch',
            'build',
            ...this.cacheFlags(cacheDir),
            ...this.scopeFlags(),
        ]
        this.logger.info(`entering watch mode: turbo ${args.join(' ')}`)

        const code = await this.run(root, args)
        throw new BuildFailedError(args, code)
    }

    /**
     * Keep Turbo's cache out of the repository, in this container only.
     *
     * This is load-bearing, not a preference. A populated cache makes Turbo
     * REPLAY a task by unpacking its tarball into `outputs` — and that unpack
     * replaces each `dist/` symlink with a real directory, silently detaching
     * the package from the shared volume so the applications see stale
     * artifacts. Measured: with the repository cache, 4 packages replayed and
     * publishers dropped from 38 files to 0.
     *
     * A private cache directory fixes it in both modes. `watch` accepts
     * `--cache-dir` but rejects `--force`, and `--no-cache` is accepted yet
     * ignored (tasks still replayed), so the cache directory is the only lever
     * that works for the long-running watch process as well as the initial
     * build.
     */
    private cacheFlags(cacheDir: string): string[] {
        mkdirSync(cacheDir, { recursive: true })
        return [`--cache-dir=${cacheDir}`]
    }

    /**
     * `--filter` flags restricting Turbo to the union.
     *
     * Scoping matters now that the whole repository is present in the container:
     * without it, Turbo would build every workspace, including packages belonging
     * only to applications that are not enabled.
     */
    private scopeFlags(): string[] {
        // ── ONE FILTER, MATCHING WHAT THE IMAGE BAKED ────────────────────────
        // This used to emit one `--filter=./<dir>` per union member (~40 of
        // them). The Dockerfile's bake uses a single
        // `--filter='!./apps/**'`, and Turbo's task hash includes the resolved
        // task graph — so the two selections produced DIFFERENT hashes for the
        // same packages and `watch` could never reuse the baked entries:
        //
        //   initial build complete (...)          ← gate opened here (before this fix)
        //   entering watch mode
        //   • Running build in 40 packages
        //   38 × "cache miss, executing …"
        //
        // Those 38 rebuilds rewrote the shared volume while the application
        // containers were compiling against it, which is what produced ~1400
        // `Module not found` errors on a cold start and a dev server stuck on
        // 500 until it was restarted.
        //
        // The union is "every workspace that is not an application", and the
        // applications are already stripped from the workspace graph by
        // `excludeApplicationsFromGraph`, so `!./apps/**` selects exactly the
        // same set — with the hash the bake already cached. The union parameter
        // was dropped rather than kept unused: the membership decision belongs to
        // the caller, and the FILTER form is what has to agree with the image.
        return ["--filter=!./apps/**"];
    }

    /**
     * Run Turbo, streaming its output, and resolve with the exit code.
     *
     * Turbo is invoked as `bun <wrapper>` rather than by executing the wrapper
     * directly, for two measured reasons:
     *
     *  - the wrapper's shebang is `#!/usr/bin/env node`, and Node is installed
     *    neither in the dev images nor on this host, so executing it fails with
     *    exit 127
     *  - the native `@turbo/<platform>` binary is not hoisted under Bun's
     *    isolated linker, so it cannot be reached by path
     *
     * Bun runs the wrapper as-is. `bun x turbo` is not used: it resolves through
     * the package installer, which blocks on an interactive prompt when the
     * version is not cached, and there is no TTY in the container to answer it.
     */
    private run(cwd: string, args: readonly string[]): Promise<number> {
        const wrapper = this.turboWrapper(cwd)

        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['--bun', wrapper, ...args], {
                cwd,
                stdio: 'inherit',
                env: { ...process.env, PKG_BUILD_KEEP_DIST: '1' },
            })

            child.on('error', reject)
            child.on('exit', (code, signal) => {
                // A signal means something killed it (compose shutdown), which is
                // not a build failure and should not be reported as one.
                resolve(signal !== null ? 0 : (code ?? 1))
            })
        })
    }

    /** Path of Turbo's CLI wrapper, which Bun executes without Node. */
    private turboWrapper(root: string): string {
        const candidates = [
            join(root, 'node_modules', 'turbo', 'bin', 'turbo'),
            join(root, 'node_modules', '.bin', 'turbo'),
        ]

        for (const candidate of candidates) {
            if (existsSync(candidate)) return candidate
        }

        this.logger.warn(
            `no Turbo under ${root}/node_modules; expecting it on PATH`
        )
        return 'turbo'
    }
}
