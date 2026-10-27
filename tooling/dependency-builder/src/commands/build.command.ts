import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { Injectable } from '@nestjs/common'
import { Command, CommandRunner, Option } from 'nest-commander'

import { scopedLogger } from '../logger'

import { UnionPlanner } from '../services/union-planner.service'
import { ApplicationDetector } from '../services/application-detector.service'
import { WorkspaceScanner } from '../services/workspace-scanner.service'
import {
    TurboRunner,
    BUILD_MARKER,
    DEFAULT_OUTPUT_ROOT,
    cacheDirFor,
} from '../services/turbo-runner.service'

interface BuildOptions {
    /** Repository root inside this container. */
    root?: string
    /**
     * Workspace name of an enabled application. Repeatable.
     *
     * Omitted by the compose profile, which relies on auto-detection from
     * `COMPOSE_PROFILES` instead — see `ApplicationDetector`.
     */
    application?: string[]
    /** Where built artifacts are published. */
    output?: string
    /** Build once and exit, instead of staying in watch mode. */
    once?: boolean
    /** Log the computed union and stop, without linking or building. */
    dryRun?: boolean
}

/**
 * The one command this tool exposes.
 *
 * Responsibilities, in order:
 *   1. discover the enabled applications (compose profile, or `--application`)
 *   2. compute the internal dependency union of those applications
 *   3. link every union member's `dist/` into the shared output volume,
 *      adopting the artifacts the IMAGE built
 *   4. build the union — skipped when step 3 found the volume complete
 *   5. publish the marker the applications gate on
 *   6. stay in Turbo watch mode
 *
 * ── WHY THE BUILD IS USUALLY SKIPPED ────────────────────────────────────────
 * The Dockerfile builds every internal package, so the artifacts already exist
 * when the container starts. Step 3 publishes them and reports the volume as
 * complete; step 4 then has nothing to do. The container's first action is
 * therefore to OPEN THE GATE, not to rebuild what the image just built.
 *
 * The applications must not start their dev servers before the artifacts are
 * published, which is why step 5 exists: compose gates them on the marker rather
 * than on a delay.
 */
@Command({
    name: 'build',
    description:
        'Build the union of internal packages required by the enabled applications, then watch them',
})
@Injectable()
export class BuildCommand extends CommandRunner {
    private readonly logger = scopedLogger(BuildCommand.name)

    constructor(
        private readonly planner: UnionPlanner,
        private readonly turbo: TurboRunner,
        private readonly detector: ApplicationDetector,
        private readonly scanner: WorkspaceScanner
    ) {
        super()
    }

    async run(_args: string[], options: BuildOptions): Promise<void> {
        // Absolute from here on: the root is the cwd for the Turbo child process
        // and the base for every package path, so a relative value would break
        // as soon as anything changed directory.
        const root = resolve(options.root ?? process.cwd())
        const outputRoot = isAbsolute(options.output ?? DEFAULT_OUTPUT_ROOT)
            ? (options.output ?? DEFAULT_OUTPUT_ROOT)
            : resolve(root, options.output ?? DEFAULT_OUTPUT_ROOT)

        if (!existsSync(join(root, 'package.json'))) {
            throw new Error(
                `No package.json at ${root}. Pass --root, or mount the repository there.`
            )
        }

        // ── THE ENABLED SET COMES FROM COMPOSE, NOT FROM A FLAG LIST ────────
        // `--application` remains for a hand-run (and for tests), but the
        // compose profile passes nothing: the enablement is whatever
        // `COMPOSE_PROFILES` says, which is the same value that decided which
        // application containers exist. A second list here is how the union and
        // the running services drift apart.
        const applications =
            options.application !== undefined && options.application.length > 0
                ? options.application
                : this.detector.detect(this.scanner.scan(root).workspaces)

        this.logger.info(`repository root: ${root}`)
        this.logger.info(`enabled applications: ${applications.join(', ')}`)

        // ── INVALIDATE THE PREVIOUS RUN'S GATE BEFORE TOUCHING ANYTHING ─────
        // The marker lives in the SHARED VOLUME, so it survives a `compose up`
        // that keeps volumes — and a stale marker is worse than no marker: every
        // application sees the gate already open and starts immediately, reading
        // a `dist/` tree this run has not finished writing (or has just cleared).
        //
        // Measured symptom on a warm restart:
        //
        //   error: Cannot find module '@deployer/auth/server' from
        //   '/app/apps/api/shared/src/config/auth/auth.ts'
        //   error: Cannot find module '../chunks/auth-client-*.mjs' from
        //   '/dep-output/packages/@deployer/auth/dist/production/esm/index.mjs'
        //
        // The second error is the giveaway: the chunk files WERE published, but
        // the consumer resolved through an index written by a run still in
        // progress. Removing the marker first makes the existing wait loop in
        // `entrypoint-app.sh` do its job on every boot, not only the first.
        const marker = join(outputRoot, BUILD_MARKER)
        rmSync(marker, { force: true })

        // 1 + 2 — the union, and the links that publish its artifacts.
        const union = this.planner.plan(root, applications)

        if (options.dryRun === true) {
            this.logger.info(
                '--dry-run given; the union above is the complete result'
            )
            return
        }

        // The return value reports whether the volume was ALREADY complete,
        // which decides whether step 3 has any work to do.
        const published = this.turbo.linkOutputs(root, union, outputRoot)

        // ── STEP 2.5 — NARROW THE GRAPH BEFORE THE FIRST TURBO PROCESS ─────
        // Deliberately NOT lazy. This edits the root `package.json`, which is
        // part of Turbo's GLOBAL HASH, so it must happen before any build whose
        // cache entries the stack will rely on — and exactly once.
        //
        // It used to run inside `buildOnce` and again inside `watch`. On a cold
        // start the initial build is SKIPPED (the image already published
        // everything), so the only call was `watch`'s, which happens AFTER the
        // marker is written. The applications were already compiling when the
        // manifest changed, every baked cache entry was invalidated, and the
        // watch phase rebuilt all 40 packages into the tree the applications
        // were resolving through — surfacing as `Module not found` for eight
        // packages on a clean first run.
        //
        // Applying it here makes the manifest constant for the container's whole
        // life: the initial build and the watch run see identical workspace
        // sets, so watch starts warm, and no app ever reads a tree being
        // rewritten underneath it.
        //
        // Safe for discovery: the plan above already ran, and `WorkspaceScanner`
        // treats the conventional trees as always-scanned.
        this.turbo.excludeApplicationsFromGraph(root)

        // 4 — A BUILD WITH THE FINAL GRAPH, BEFORE THE GATE OPENS.
        //
        // ── WHY THIS IS NOT CONDITIONAL ON `published` ──────────────────────
        // It used to be: "the image already published everything → skip". That
        // skip is what produced the cold-start failure, because the image's bake
        // and `turbo watch` do not hash the same graph:
        //
        //   Dockerfile : turbo run build --filter='!./apps/**'   (apps PRESENT in workspaces)
        //   watch      : same filter, but AFTER `excludeApplicationsFromGraph`
        //                strips `apps/**` — a DIFFERENT resolved task graph
        //
        // Turbo's hash includes that graph, so watch could never reuse the baked
        // entries. Measured on a cold start with a wiped volume:
        //
        //   [BuildCommand] every package is already published; skipping the initial build
        //   [BuildCommand] initial build complete        ← gate opens, apps start compiling
        //   [TurboRunner]  entering watch mode
        //   • Running build in 42 packages
        //   40 × "cache miss, executing …"               ← volume rewritten under the apps
        //
        // The result was ~715 `Module not found` errors and a 500-ing dev server
        // that a single restart always fixed — the signature of a race.
        //
        // So the build ALWAYS runs here. It is cheap when the hashes do line up
        // (a `FULL TURBO` replay of the image's cache), and when they do not it
        // finishes BEFORE the marker is written, so no application ever compiles
        // against a volume being rewritten. `watch` then starts warm.
        //
        // `published` still matters for diagnostics, so it is logged.
        const cacheDir = cacheDirFor(outputRoot)
        this.logger.info(
            published
                ? 'image output adopted into the volume; running a build with the watch graph so `turbo watch` starts warm'
                : 'volume was incomplete; building the union before opening the gate'
        )
        await this.turbo.buildOnce(root, union, cacheDir)

        // 5 — the gate the applications wait on. Written only once every artifact
        // is on the volume AND nothing is still rebuilding it.
        writeFileSync(marker, `${new Date().toISOString()}\n`)
        this.logger.info(`initial build complete (${marker})`)

        if (options.once === true) {
            this.logger.info('--once given; exiting after the initial build')
            return
        }

        // 6 — stay up, rebuilding the union as its sources change.
        await this.turbo.watch(root, union, cacheDir)
    }

    @Option({
        flags: '-r, --root <path>',
        description: 'Repository root inside the container',
    })
    parseRoot(value: string): string {
        return value
    }

    @Option({
        flags: '-a, --application <name>',
        description:
            'Workspace name of an enabled application (repeatable). Omit to auto-detect from COMPOSE_PROFILES.',
    })
    parseApplication(value: string, previous: string[] = []): string[] {
        return [...previous, value]
    }

    @Option({
        flags: '-o, --output <path>',
        description: 'Directory the built artifacts are published to',
    })
    parseOutput(value: string): string {
        return value
    }

    @Option({
        flags: '--once',
        description: 'Build once and exit, without entering watch mode',
    })
    parseOnce(): boolean {
        return true
    }

    @Option({
        flags: '--dry-run',
        description:
            'Log the computed union and stop, without linking or building',
    })
    parseDryRun(): boolean {
        return true
    }
}
