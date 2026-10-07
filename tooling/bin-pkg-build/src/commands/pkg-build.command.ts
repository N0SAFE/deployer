import { Injectable } from '@nestjs/common'
import { CommandRunner, Option, RootCommand } from 'nest-commander'

import {
    PkgBuilderService,
    type PkgBuildRunOptions,
} from '../services/pkg-builder.service'

/**
 * `pkg-build` — the workspace package builder.
 *
 * Declared as the ROOT command (nest-commander's `@RootCommand`) so existing
 * call sites can stay flag-only:
 *
 *     pkg-build                 JS + declarations, one shot
 *     pkg-build --types         declarations only (`build:types`)
 *     pkg-build --watch         rebuild on change (`dev`)
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

    async run(
        _passedParams: string[],
        options?: PkgBuildRunOptions
    ): Promise<void> {
        await this.builder.run({
            watch: options?.watch === true,
            types: options?.types === true,
        })
    }
}
