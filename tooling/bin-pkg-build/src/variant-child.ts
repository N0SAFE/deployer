#!/usr/bin/env bun
import { PkgBuilderService, modeFromEnv } from './services/pkg-builder.service'
import { PkgConfigService } from './services/pkg-config.service'
import { die } from './utils/errors'
import type { BuildMode, Variant } from './config'

/**
 * Variant child entry.
 *
 * `bun build` samples `NODE_ENV` at process start to pick the React JSX runtime,
 * so each variant must be built in a fresh process (see `PkgBuilderService`).
 * This entry is spawned with `NODE_ENV` already set by the parent and builds
 * exactly one variant.
 *
 * The parent passes the build mode explicitly (`--mode`), because the child's own
 * `NODE_ENV` has been overwritten with the variant and can no longer say whether
 * the overall build is a development or production one. `modeFromEnv()` is only
 * the fallback for a hand-run child.
 *
 * It deliberately does NOT boot Nest/commander: the child needs one service
 * call, and paying the CLI bootstrap per variant would be pure overhead.
 */
const VARIANT_PREFIX = '--variant='
const MODE_PREFIX = '--mode='

/** Read a `--flag=value` argument, or `undefined`. */
function flag(prefix: string): string | undefined {
    return process.argv
        .find((a) => a.startsWith(prefix))
        ?.slice(prefix.length)
}

async function main(): Promise<void> {
    const variant = flag(VARIANT_PREFIX)
    if (variant === undefined) {
        die('variant child requires --variant=<development|production>')
    }
    if (variant !== 'development' && variant !== 'production') {
        die(`unknown variant: ${variant}`)
    }

    const mode = (flag(MODE_PREFIX) ?? modeFromEnv()) as BuildMode
    if (mode !== 'dev' && mode !== 'prod') {
        die(`unknown mode: ${String(mode)}`)
    }

    const config = await PkgConfigService.create(process.cwd())
    const builder = new PkgBuilderService(config)
    await builder.buildVariant(mode, variant)
}

void main().catch((error: unknown) => {
    die(error instanceof Error ? error.message : String(error))
})
