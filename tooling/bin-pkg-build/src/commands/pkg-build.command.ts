import { Injectable } from '@nestjs/common'
import { CommandRunner, Option, RootCommand } from 'nest-commander'

import {
    PkgBuilderService,
    type PkgBuildRunOptions,
} from '../services/pkg-builder.service'
import type { BuildMode } from '../config'

/**
 * `pkg-build` — the workspace package builder.
 *
 * Declared as the ROOT command (nest-commander's `@RootCommand`) so existing
 * call sites can stay flag-only:
 *
 *     pkg-build                 JS + declarations, one shot
 *     pkg-build --types         declarations only (`build:types`)
 *     pkg-build --watch         rebuild on change (`dev`)
 *     pkg-build --mode=dev      unminified JS + sourcemaps (implied by NODE_ENV)
 *
 * The flags stay flags rather than becoming config keys on purpose: the same
 * config is built three ways (JS+types, `build:types`, `dev` watch), so which
 * half to run is a property of the *invocation*, not of the package. Moving them
 * into the config would need three configs per package to express one pipeline.
 */
@RootCommand({
    name: 'pkg-build',
    description: 'Build a workspace package: JS bundles + declarations',
})
@Injectable()
export class PkgBuildCommand extends CommandRunner {
    constructor(private readonly builder: PkgBuilderService) {
        super()
    }

    @Option({
        flags: '-w, --watch',
        description: 'Rebuild on change (JS + declarations)',
    })
    parseWatch(): boolean {
        return true
    }

    @Option({
        flags: '-t, --types',
        description: 'Emit declarations only (dist/types); JS output untouched',
    })
    parseTypes(): boolean {
        return true
    }

    @Option({
        flags: '-m, --mode <mode>',
        description:
            'Build target: dev (unminified + sourcemaps) or prod. Defaults to what NODE_ENV implies.',
    })
    parseMode(mode: string): BuildMode {
        if (mode !== 'dev' && mode !== 'prod') {
            throw new Error(`--mode must be "dev" or "prod", got "${mode}"`)
        }
        return mode
    }

    async run(
        _passedParams: string[],
        options?: PkgBuildRunOptions
    ): Promise<void> {
        await this.builder.run({
            watch: options?.watch === true,
            types: options?.types === true,
            mode: options?.mode,
        })
    }
}
