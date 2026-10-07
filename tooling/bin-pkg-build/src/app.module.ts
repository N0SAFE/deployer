import { Module } from '@nestjs/common'

import { PkgBuildCommand } from './commands/pkg-build.command'
import { PkgBuilderService } from './services/pkg-builder.service'
import { PkgConfigService } from './services/pkg-config.service'

/**
 * The CLI application graph.
 *
 * `PkgConfigService` is created from the process cwd (the consuming package):
 * the CLI is always launched from the package it builds, exactly like the
 * previous script. The factory provider keeps that path explicit instead of
 * relying on a default constructor parameter, which Nest cannot inject.
 */
@Module({
    providers: [
        {
            provide: PkgConfigService,
            useFactory: () => new PkgConfigService(),
        },
        PkgBuilderService,
        PkgBuildCommand,
    ],
})
export class AppModule {}
