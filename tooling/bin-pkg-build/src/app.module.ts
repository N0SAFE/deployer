import { Module } from '@nestjs/common'

import { PkgBuildCommand } from './commands/pkg-build.command'
import { PkgBuilderService } from './services/pkg-builder.service'
import { PkgConfigService } from './services/pkg-config.service'

/**
 * The CLI application graph.
 *
 * `PkgConfigService` is created from the process cwd (the consuming package):
 * the CLI is always launched from the package it builds. Its construction is
 * async because the package's `pkg-build.config.ts` is an ES module that has to
 * be imported, so the provider is an async factory rather than a plain class.
 */
@Module({
    providers: [
        {
            provide: PkgConfigService,
            useFactory: (): Promise<PkgConfigService> =>
                PkgConfigService.create(),
        },
        PkgBuilderService,
        PkgBuildCommand,
    ],
})
export class AppModule {}
