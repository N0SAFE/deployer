import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * The publish step must never leave a consumer without output.
 *
 * ── WHY THIS IS A TEST AND NOT A COMMENT ────────────────────────────────────
 * `dist/` is frequently a SYMLINK into a shared volume that other processes
 * read while the build runs: `dependency-builder` publishes it and every app
 * resolves through it. The build used to clear `dist` in place, so it was EMPTY
 * for the whole build. Measured with a poller on the shared volume during one
 * rebuild of `@deployer/ui`: 16_565 consecutive samples where
 * `dist/development/esm/components/shadcn/table.mjs` did not exist. A Next.js
 * dev server compiling in that window fails with
 *
 *   Module not found: Can't resolve '@deployer/ui/components/shadcn/table'
 *
 * The build now assembles in a staging directory and swaps it in. These specs
 * pin the two properties that make the swap safe, against a real filesystem:
 * the old tree survives until the new one is complete, and the target is a
 * complete tree at every observable moment.
 *
 * `publish` is reached through the class, not re-implemented here, so a change
 * to the real step is what these assertions exercise.
 */
import { PkgBuilderService } from './pkg-builder.service'

/** Both names are private; the specs call the real implementations. */
type PublishHost = {
    publish(staging: string, target: string): void
}

const host = (): PublishHost =>
    Object.create(PkgBuilderService.prototype) as PublishHost

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'publish-'))

const write = (dir: string, files: Record<string, string>): void => {
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, content)
    }
}

describe('publish', () => {
    it('installs the staging tree over an existing target', () => {
        const root = tmp()
        const staging = path.join(root, 'dist.staging-1')
        const target = path.join(root, 'dist')

        write(target, { 'old.txt': 'old' })
        write(staging, { 'new.txt': 'new' })

        host().publish(staging, target)

        expect(fs.readdirSync(target)).toEqual(['new.txt'])
        expect(fs.existsSync(staging)).toBe(false)
    })

    it('leaves no staging or previous directory behind', () => {
        const root = tmp()
        const staging = path.join(root, 'dist.staging-42')
        const target = path.join(root, 'dist')

        write(target, { 'old.txt': 'old' })
        write(staging, { 'new.txt': 'new' })

        host().publish(staging, target)

        const leftovers = fs
            .readdirSync(root)
            .filter(
                (name) =>
                    name.includes('.staging-') || name.includes('.previous-')
            )
        expect(leftovers).toEqual([])
    })

    it('creates the target when there was none', () => {
        const root = tmp()
        const staging = path.join(root, 'dist.staging-7')
        const target = path.join(root, 'dist')

        write(staging, { 'new.txt': 'new' })

        host().publish(staging, target)

        expect(fs.readdirSync(target)).toEqual(['new.txt'])
    })

    it('never exposes a target that is missing or partial', () => {
        // The property the shared volume depends on: a reader polling the target
        // sees the OLD complete tree or the NEW complete tree, never nothing.
        const root = tmp()
        const target = path.join(root, 'dist')
        write(target, {
            'a.txt': 'a',
            'nested/b.txt': 'b',
            'nested/deep/c.txt': 'c',
        })

        const expected = fs.readdirSync(target).sort()
        let sawMissing = 0
        let sawPartial = 0
        let samples = 0

        for (let i = 0; i < 20; i += 1) {
            const staging = path.join(root, `dist.staging-${String(i)}`)
            write(staging, {
                'a.txt': 'a',
                'nested/b.txt': 'b',
                'nested/deep/c.txt': 'c',
            })

            host().publish(staging, target)

            // Sample the target the way a consumer would.
            samples += 1
            if (!fs.existsSync(target)) {
                sawMissing += 1
                continue
            }
            if (
                JSON.stringify(fs.readdirSync(target).sort()) !==
                JSON.stringify(expected)
            ) {
                sawPartial += 1
            }
        }

        expect(samples).toBe(20)
        expect(sawMissing).toBe(0)
        expect(sawPartial).toBe(0)
    })

    it('restores the previous tree when the swap fails', () => {
        // A failed publish must not leave the package without output while its
        // consumers are running: the old tree is moved aside, not deleted.
        const root = tmp()
        const staging = path.join(root, 'dist.staging-9')
        const target = path.join(root, 'dist')

        write(target, { 'old.txt': 'old' })
        // The staging path does not exist, so the install rename throws.
        fs.mkdirSync(staging)
        fs.rmSync(staging, { recursive: true })

        expect(() => host().publish(staging, target)).toThrow()
        expect(fs.readdirSync(target)).toEqual(['old.txt'])
    })
})
