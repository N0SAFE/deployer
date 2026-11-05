import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * `publish` when the filesystem refuses a directory rename.
 *
 * ── THE FAILURE THIS COVERS ─────────────────────────────────────────────────
 * The dependency-builder image bakes every package's `dist/` into a lower
 * overlay layer, then rebuilds at runtime. Overlayfs cannot rename a directory
 * that has not been copied up, so the swap failed and the staging tree leaked:
 *
 *   Error: EXDEV: cross-device link not permitted,
 *     rename '/app/tooling/bin-runthenkill/dist' -> '.../dist.previous-1261'
 *
 * Measured residue on the publishing volume: 7 abandoned `dist.staging-*` trees
 * (`ui`, `runtime-contracts`, `mesh-service`, …). The fix merges entry by entry
 * on `EXDEV`, which only ever renames upper-layer paths.
 *
 * `node:fs` is mocked MODULE-WIDE here because a `vi.spyOn` on an ESM namespace
 * is rejected (`Cannot replace module namespace object's binding`). Only
 * `renameSync` is replaced; everything else delegates to the real module, so the
 * filesystem behaviour under test is genuine.
 */
const renameFailure = { remaining: 1 }

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>()
    return {
        ...actual,
        default: actual,
        renameSync: ((from: fs.PathLike, to: fs.PathLike) => {
            if (renameFailure.remaining > 0) {
                renameFailure.remaining -= 1
                const error = new Error(
                    'EXDEV: cross-device link not permitted'
                ) as NodeJS.ErrnoException
                error.code = 'EXDEV'
                throw error
            }
            return actual.renameSync(from, to)
        }) as typeof actual.renameSync,
    }
})

/** Imported AFTER the mock so the service sees the replaced binding. */
const { PkgBuilderService } = await import('./pkg-builder.service')

type PublishHost = { publish(staging: string, target: string): void }

const host = (): PublishHost =>
    Object.create(PkgBuilderService.prototype) as PublishHost

const write = (dir: string, files: Record<string, string>): void => {
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, content)
    }
}

afterEach(() => {
    renameFailure.remaining = 1
})

describe('publish on a filesystem that refuses directory renames', () => {
    it('merges the entries in and removes the staging tree', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-exdev-'))
        const staging = path.join(root, 'dist.staging-3')
        const target = path.join(root, 'dist')

        write(target, { 'old.txt': 'old' })
        write(staging, { 'new.txt': 'new', 'nested/new.txt': 'new' })

        host().publish(staging, target)

        expect(fs.existsSync(path.join(target, 'new.txt'))).toBe(true)
        expect(fs.existsSync(path.join(target, 'nested/new.txt'))).toBe(true)
        // The abandoned staging tree must not survive: it is what accumulated on
        // the volume before the fallback existed.
        expect(fs.existsSync(staging)).toBe(false)
    })

    it('replaces a stale entry rather than merging into it', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-exdev-'))
        const staging = path.join(root, 'dist.staging-4')
        const target = path.join(root, 'dist')

        write(target, { 'same.txt': 'OLD', 'only-in-old.txt': 'old' })
        write(staging, { 'same.txt': 'NEW' })

        host().publish(staging, target)

        expect(fs.readFileSync(path.join(target, 'same.txt'), 'utf8')).toBe(
            'NEW'
        )
    })
})
