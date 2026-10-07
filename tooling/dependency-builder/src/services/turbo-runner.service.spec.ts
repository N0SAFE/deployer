import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { TurboRunner } from './turbo-runner.service'
import type { UnionMember } from '../schemas'

/**
 * The two failures that made the dev stack unusable, encoded so they cannot come
 * back. Both were diagnosed from a running stack, and both are load-bearing.
 */

/** Build a throwaway repository tree with the given packages. */
function makeRepo(
    packages: Record<string, { name: string; build?: boolean }>
): string {
    const root = mkdtempSync(join(tmpdir(), 'turbo-runner-'))

    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify(
            {
                name: 'root',
                private: true,
                packageManager: 'bun@1.4.2',
                workspaces: {
                    packages: ['apps/**', 'packages/**', 'tools/**'],
                },
            },
            null,
            4
        )
    )

    for (const [dir, spec] of Object.entries(packages)) {
        const abs = join(root, dir)
        mkdirSync(abs, { recursive: true })
        writeFileSync(
            join(abs, 'package.json'),
            JSON.stringify({
                name: spec.name,
                version: '1.0.0',
                ...(spec.build === false
                    ? {}
                    : { scripts: { build: 'echo built' } }),
            })
        )
        if (spec.build !== false) {
            mkdirSync(join(abs, 'dist'), { recursive: true })
            writeFileSync(
                join(abs, 'dist', 'index.mjs'),
                'export const x = 1\n'
            )
        }
    }

    return root
}

function member(
    name: string,
    dir: string,
    contributors = ['api']
): UnionMember {
    return { name, dir, contributors }
}

describe('TurboRunner', () => {
    const roots: string[] = []

    afterEach(() => {
        for (const root of roots.splice(0))
            rmSync(root, { recursive: true, force: true })
    })

    function repo(
        packages: Record<string, { name: string; build?: boolean }>
    ): string {
        const root = makeRepo(packages)
        roots.push(root)
        return root
    }

    /** Reach the private graph-guard without casting the runner to `any`. */
    function excludeApps(runner: TurboRunner, root: string): void {
        ;(
            runner as unknown as {
                excludeApplicationsFromGraph(r: string): void
            }
        ).excludeApplicationsFromGraph(root)
    }

    describe('excludeApplicationsFromGraph', () => {
        it('removes the app globs and keeps the package and tool globs', () => {
            const root = repo({})
            const runner = new TurboRunner()

            excludeApps(runner, root)

            const manifest = JSON.parse(
                readFileSync(join(root, 'package.json'), 'utf8')
            ) as {
                workspaces: { packages: string[] }
            }

            // Apps must be gone: Turbo rebuilds whoever depends on a changed
            // package, and the applications depend on everything.
            expect(
                manifest.workspaces.packages.some((w) => w.startsWith('apps'))
            ).toBe(false)
            // Packages and tools must stay: the union is built from them.
            expect(manifest.workspaces.packages).toContain('packages/**')
            expect(manifest.workspaces.packages).toContain('tools/**')
        })

        it('is idempotent, so buildOnce and watch can each call it', () => {
            const root = repo({})
            const runner = new TurboRunner()

            excludeApps(runner, root)
            const once = readFileSync(join(root, 'package.json'), 'utf8')

            excludeApps(runner, root)
            expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(once)
        })

        it('leaves a manifest without apps untouched', () => {
            const root = repo({})
            const manifestPath = join(root, 'package.json')
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
                workspaces: { packages: string[] }
            }
            manifest.workspaces.packages = ['packages/**']
            writeFileSync(manifestPath, JSON.stringify(manifest, null, 4))

            const runner = new TurboRunner()
            excludeApps(runner, root)

            expect(
                (
                    JSON.parse(readFileSync(manifestPath, 'utf8')) as {
                        workspaces: { packages: string[] }
                    }
                ).workspaces.packages
            ).toEqual(['packages/**'])
        })

        it('survives an unreadable manifest instead of throwing', () => {
            const root = repo({})
            writeFileSync(join(root, 'package.json'), '{ not json')

            const runner = new TurboRunner()
            expect(() => excludeApps(runner, root)).not.toThrow()
        })
    })

    describe('linkOutputs publishes a resolvable tree', () => {
        it('puts package.json next to the published dist, so its exports map applies', () => {
            const root = repo({
                'packages/infrastructure/logger': { name: '@repo/logger' },
            })
            const out = join(root, 'out')
            const runner = new TurboRunner()

            runner.linkOutputs(
                root,
                [member('@repo/logger', 'packages/infrastructure/logger')],
                out
            )

            // Without the manifest the published .mjs resolves nothing: the
            // exports map that maps subpaths onto files lives in this file.
            expect(
                existsSync(join(out, 'packages/@repo/logger/package.json'))
            ).toBe(true)
            // The package's own dist is now a link into the volume. The volume
            // target starts empty — Turbo fills it — so assert the link, not
            // its contents.
            const published = join(out, 'packages/@repo/logger/dist')
            expect(existsSync(published)).toBe(true)
            expect(lstatSync(published).isDirectory()).toBe(true)
        })

        it('links the package tree into the volume so bare imports resolve', () => {
            const root = repo({
                'packages/infrastructure/logger': { name: '@repo/logger' },
            })
            mkdirSync(join(root, 'packages/infrastructure/logger/node_modules'), {
                recursive: true,
            })
            const out = join(root, 'out')
            const runner = new TurboRunner()

            runner.linkOutputs(
                root,
                [member('@repo/logger', 'packages/infrastructure/logger')],
                out
            )

            // A published file importing `rxjs` walks UP from its own directory;
            // this link is what makes that walk find the package's own tree.
            const linked = join(out, 'packages/@repo/logger/node_modules')
            expect(existsSync(linked)).toBe(true)
            expect(
                readFileSync(
                    join(root, 'packages/infrastructure/logger/package.json'),
                    'utf8'
                )
            ).toContain('@repo/logger')
        })

        it('skips packages with no build script, matching what it links', () => {
            const root = repo({
                'tooling/typescript': {
                    name: '@repo/config-typescript',
                    build: false,
                },
            })
            const out = join(root, 'out')
            const runner = new TurboRunner()

            runner.linkOutputs(
                root,
                [
                    member(
                        '@repo/config-typescript',
                        'tooling/typescript'
                    ),
                ],
                out
            )

            expect(
                existsSync(join(out, 'packages/@repo/config-typescript/dist'))
            ).toBe(false)
        })

        it('keeps dist a symlink into the volume across runs', () => {
            const root = repo({
                'packages/infrastructure/logger': { name: '@repo/logger' },
            })
            const out = join(root, 'out')
            const runner = new TurboRunner()
            const union = [member('@repo/logger', 'packages/infrastructure/logger')]
            const link = join(root, 'packages/infrastructure/logger/dist')

            runner.linkOutputs(root, union, out)
            expect(lstatSync(link).isSymbolicLink()).toBe(true)

            runner.linkOutputs(root, union, out)

            // A real directory here is the failure mode: it detaches the package
            // from the volume and every later write lands in the repo instead.
            expect(lstatSync(link).isSymbolicLink()).toBe(true)
            expect(realpathSync(link)).toBe(
                realpathSync(join(out, 'packages/@repo/logger/dist'))
            )
        })
    })
})
