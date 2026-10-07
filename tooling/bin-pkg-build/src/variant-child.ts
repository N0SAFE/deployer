#!/usr/bin/env bun
import { PkgBuilderService } from './services/pkg-builder.service'
import { PkgConfigService, type Variant } from './services/pkg-config.service'
import { die } from './utils/errors'

/**
 * Variant child entry.
 *
 * `bun build` samples `NODE_ENV` at process start to pick the React JSX runtime,
 * so each variant must be built in a fresh process (see `PkgBuilderService`).
 * This entry is spawned with `NODE_ENV` already set by the parent and builds
 * exactly one variant.
 *
 * It deliberately does NOT boot Nest/commander: the child needs one service
 * call, and paying the CLI bootstrap per variant would be pure overhead.
 */
const VARIANT_PREFIX = '--variant='

async function main(): Promise<void> {
    const arg = process.argv.find((a) => a.startsWith(VARIANT_PREFIX))
    if (arg === undefined) {
        die('variant child requires --variant=<development|production>')
    }
    const variant = arg.slice(VARIANT_PREFIX.length)
    if (variant !== 'development' && variant !== 'production') {
        die(`unknown variant: ${variant}`)
    }

    const config = new PkgConfigService(process.cwd())
    const builder = new PkgBuilderService(config)
    await builder.buildVariant(variant as Variant)
}

void main().catch((error: unknown) => {
    die(error instanceof Error ? error.message : String(error))
})
