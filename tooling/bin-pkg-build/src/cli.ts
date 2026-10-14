#!/usr/bin/env bun
import 'reflect-metadata'

import { Module, type DynamicModule } from '@nestjs/common'

import { PkgBuildCommand } from './commands/pkg-build.command'
import { run } from './cli-runtime'
import { PkgBuilderService } from './services/pkg-builder.service'
import { PkgConfigService } from './services/pkg-config.service'
import type { PkgBuildConfig } from './config'

/**
 * The command graph with the package's config **already in hand**.
 *
 * A second module rather than a second provider in `AppModule` on purpose: the
 * two ways to run the CLI differ only in where the config comes from (this
 * process loaded it, or the cwd is named by it), so they are two providers for
 * one token — the kind of duplicate NestJS resolves by declaration order, which
 * is exactly the ambiguity worth avoiding. Each module here supplies
 * `PkgConfigService` once, unambiguously.
 *
 * The class carries no static metadata because a dynamic module's providers live
 * on the object `forConfig` returns, not on the decorator.
 */
@Module({})
export class RunBuildModule {
    static forConfig(config: PkgBuildConfig): DynamicModule {
        return {
            module: RunBuildModule,
            providers: [
                // Already resolved: this path reached the config by importing it.
                {
                    provide: PkgConfigService,
                    useValue: PkgConfigService.fromAuthored(config),
                },
                PkgBuilderService,
                PkgBuildCommand,
            ],
        }
    }
}

/**
 * Run the build for a config this process already holds.
 *
 * Called by `build()` in `config.ts`, which is the entry point a package's
 * `pkg-build.config.ts` invokes — so the config was necessarily loaded to get
 * here and must not be read a second time.
 */
export async function runCli(
    config: PkgBuildConfig,
    argv: string[]
): Promise<never> {
    return run(RunBuildModule.forConfig(config), argv)
}
