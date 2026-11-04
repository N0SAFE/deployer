import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Orphaned staging trees must be reclaimed, without touching a live build.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A build that is killed (container stop, CI timeout, a crash) never reaches
 * `publish`, so its `dist.staging-<pid>` stays on the publishing volume. The
 * measured residue after the atomic-publish change was 7 directories: `ui`,
 * `runtime-contracts`, `mesh-service`, `bin-runthenkill` and others. Each is a
 * full output tree, so they accumulate at the rate of one per kill.
 *
 * The sweep is keyed on pid liveness, and that distinction is the whole point: a
 * sweep that deleted every `*.staging-*` would corrupt the output of any build
 * running at the same time — which, with `turbo run build` running dozens of
 * packages in parallel, is the normal case rather than an edge case.
 */
import { sweepOrphanedStaging } from './pkg-builder.service'

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'staging-sweep-'))

const write = (dir: string, files: Record<string, string>): void => {
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, content)
    }
}

/**
 * A pid nobody can hold.
 *
 * Linux's default `pid_max` is 4_194_304 (2^22), so a value ABOVE it is never
 * allocated and `kill(pid, 0)` always answers `ESRCH` — the residue a killed
 * build leaves. A lower number would only be *probably* free: on a busy host the
 * allocator could reach it, and the test would fail intermittently for a reason
 * that has nothing to do with the code under test.
 */
const DEAD_PID = 4_194_305

describe('sweepOrphanedStaging', () => {
    /** `true` when no process holds `pid` — the precondition of the reclaim test. */
    const isDead = (pid: number): boolean => {
        try {
            process.kill(pid, 0)
            return false
        } catch (error) {
            return (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                (error as { code?: unknown }).code === 'ESRCH'
            )
        }
    }

    it('reclaims the staging tree of a dead pid', () => {
        // The reclaim test is only meaningful for a pid that is genuinely free, so
        // the precondition is asserted instead of assumed: `pid_max` is tunable,
        // and a raised one would otherwise turn this into a flaky failure that
        // looks like a sweep bug.
        expect(
            isDead(DEAD_PID),
            `pid ${String(DEAD_PID)} is in use on this host; the test needs a free pid`
        ).toBe(true)

        const root = tmp()
        const dist = path.join(root, 'dist')
        const orphan = `${dist}.staging-${String(DEAD_PID)}`
        write(dist, { 'index.mjs': 'ok' })
        write(orphan, { 'partial/x.mjs': 'x' })

        sweepOrphanedStaging(dist)

        expect(fs.existsSync(orphan)).toBe(false)
        // The published tree is untouched.
        expect(fs.existsSync(path.join(dist, 'index.mjs'))).toBe(true)
    })

    it("keeps a live build's staging tree", () => {
        // The pid of THIS process is by definition alive: a build in progress must
        // never have its tree deleted underneath it.
        const root = tmp()
        const dist = path.join(root, 'dist')
        const live = `${dist}.staging-${String(process.pid)}`
        write(dist, { 'index.mjs': 'ok' })
        write(live, { 'partial/x.mjs': 'x' })

        sweepOrphanedStaging(dist)

        expect(fs.existsSync(live)).toBe(true)
    })

    it("leaves a sibling package's staging alone", () => {
        // The sweep is scoped to the target's own prefix. `dist` and `dist-other`
        // share a parent, and a prefix match without the dot would let one
        // package's sweep delete another package's tree.
        const root = tmp()
        const dist = path.join(root, 'dist')
        const other = path.join(root, `dist-other.staging-${String(DEAD_PID)}`)
        write(dist, { 'index.mjs': 'ok' })
        write(other, { 'x.mjs': 'x' })

        sweepOrphanedStaging(dist)

        expect(fs.existsSync(other)).toBe(true)
    })

    it('ignores names that are not a staging tree', () => {
        const root = tmp()
        const dist = path.join(root, 'dist')
        write(dist, { 'index.mjs': 'ok' })
        // `dist.staging-` with no pid, and a non-numeric suffix: both are names
        // this code never writes, so guessing at them would be worse than leaving
        // them for a human.
        const nameless = `${dist}.staging-`
        const bogus = `${dist}.staging-abc`
        fs.mkdirSync(nameless, { recursive: true })
        fs.mkdirSync(bogus, { recursive: true })

        sweepOrphanedStaging(dist)

        expect(fs.existsSync(nameless)).toBe(true)
        expect(fs.existsSync(bogus)).toBe(true)
    })

    it('does nothing when the package has no output directory yet', () => {
        // A first build has no `dist`, and `readdirSync` runs on the PARENT, so the
        // function must not throw when the target is absent.
        const root = tmp()
        expect(() => sweepOrphanedStaging(path.join(root, 'dist'))).not.toThrow()
    })
})
