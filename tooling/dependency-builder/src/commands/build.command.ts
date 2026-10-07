import { existsSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { Injectable } from '@nestjs/common'
import { Command, CommandRunner, Option } from 'nest-commander'

import { scopedLogger } from '../logger'

import { UnionPlanner } from '../services/union-planner.service'
import {
    TurboRunner,
    BUILD_MARKER,
    DEFAULT_OUTPUT_ROOT,
    cacheDirFor,
} from '../services/turbo-runner.service'

interface BuildOptions {
    /** Repository root inside this container. */
    root?: string
    /** Workspace name of an enabled application. Repeatable. */
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
 *   1. discover the enabled applications' internal dependency union
 *   2. link every union member's `dist/` into the shared output volume
 *   3. build the union once, through a single Turbo graph
 *   4. publish the marker the applications gate on
 *   5. stay in Turbo watch mode
 *
 * The applications must not start their dev servers before step 3 finishes,
 * which is why step 4 exists: compose gates them on the marker rather than on a
 * delay.
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
        private readonly turbo: TurboRunner
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
        const applications = options.application ?? []

        if (applications.length === 0) {
            throw new Error(
                'At least one --application is required (the workspace name of an enabled application).'
            )
        }

        if (!existsSync(join(root, 'package.json'))) {
            throw new Error(
                `No package.json at ${root}. Pass --root, or mount the repository there.`
            )
        }

        this.logger.info(`repository root: ${root}`)
        this.logger.info(`enabled applications: ${applications.join(', ')}`)

        // 1 + 2 — the union, and the links that publish its artifacts.
        const union = this.planner.plan(root, applications)

        if (options.dryRun === true) {
            this.logger.info(
                '--dry-run given; the union above is the complete result'
            )
            return
        }

        this.turbo.linkOutputs(root, union, outputRoot)

        // 3 — one build, one graph.
        const cacheDir = cacheDirFor(outputRoot)
        await this.turbo.buildOnce(root, union, cacheDir)

        // 4 — the gate the applications wait on.
        const marker = join(outputRoot, BUILD_MARKER)
        writeFileSync(marker, `${new Date().toISOString()}\n`)
        this.logger.info(`initial build complete (${marker})`)

        if (options.once === true) {
            this.logger.info('--once given; exiting after the initial build')
            return
        }

        // 5 — stay up, rebuilding the union as its sources change.
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
        description: 'Workspace name of an enabled application (repeatable)',
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
