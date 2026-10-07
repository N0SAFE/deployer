import { describe, expect, it, vi } from 'vitest'

/**
 * The builder module imports Bun's bundler, which vitest (node) cannot resolve.
 * The command only delegates, so the module is mocked; the spy is created with
 * `vi.hoisted` because `vi.mock` factories run before ordinary top-level code.
 */
const { runMock } = vi.hoisted(() => ({
    runMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../services/pkg-builder.service', () => ({
    PkgBuilderService: class {
        readonly run = runMock
    },
}))

import { PkgBuildCommand } from './pkg-build.command'
import { PkgBuilderService } from '../services/pkg-builder.service'
import { PkgConfigService } from '../services/pkg-config.service'

function createCommand(): PkgBuildCommand {
    return new PkgBuildCommand(
        new PkgBuilderService(new PkgConfigService(process.cwd()))
    )
}

describe('PkgBuildCommand', () => {
    it('defaults to a one-shot JS + types build', async () => {
        await createCommand().run([])

        expect(runMock).toHaveBeenCalledWith({ watch: false, types: false })
    })

    it('forwards --watch and --types', async () => {
        await createCommand().run([], { watch: true, types: true })

        expect(runMock).toHaveBeenCalledWith({ watch: true, types: true })
    })
})
