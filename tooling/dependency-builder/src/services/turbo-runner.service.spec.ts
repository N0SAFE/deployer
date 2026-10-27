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

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')

/**
 * The cache-key environment must agree between the image build and the runtime.
 *
 * ── WHY THIS IS A TEST AND NOT A COMMENT ────────────────────────────────────
 * `turbo.json` lists `NODE_ENV` and `LOG_LEVEL` in `globalEnv`, so BOTH feed
 * every task's cache key. The Dockerfile builds the cache and the compose
 * service runs the build that should REUSE it — and when the two disagreed by
 * these variables, every lookup missed, permanently and silently:
 *
 *   @deployer/type-guards:build: cache miss, executing 8e8ad2152680e352   (image)
 *   @deployer/type-guards:build: cache miss, executing 03d9cabe0b8c28c4   (runtime)
 *
 * Nothing reported that as wrong: the build still succeeded, just without the
 * cache it was built to provide. A silent regression needs an assertion.
 */
describe('cache-key environment', () => {
    /** Variables that are both in `globalEnv` and set for the build. */
    const SHARED = ['NODE_ENV', 'LOG_LEVEL'] as const

    function readEnvOf(relativePath: string): Map<string, string> {
        const found = new Map<string, string>()
        for (const line of readFileSync(join(REPO_ROOT, relativePath), 'utf8').split('\n')) {
            // Skip comments: a doc line mentioning the variable is not a
            // declaration, and matching one produced a value with a stray
            // character during development of this very test.
            const code = line.split('#')[0] ?? ''
            for (const name of SHARED) {
                // Dockerfile `ENV K=V` and compose `K: V`, anchored at the start
                // of the line so an inline mention cannot match.
                const match = code.match(
                    new RegExp(`^\\s*(?:ENV\\s+)?${name}[:=\\s]+["']?([^"'\\s]+)`)
                )
                if (match?.[1] !== undefined) found.set(name, match[1])
            }
        }
        return found
    }

    it('is set identically in the builder image and the compose service', () => {
        const image = readEnvOf(
            'infra/docker/builder/dependency-builder/Dockerfile.dependency-builder.dev'
        )
        const service = readEnvOf(
            'infra/docker/compose/common/dependency-builder/docker-compose.config.dev.yml'
        )

        for (const name of SHARED) {
            expect(
                image.get(name),
                `${name} is missing from the builder image; the runtime cache will never hit`
            ).toBeDefined()
            expect(
                image.get(name),
                `${name} differs between the image and the compose service, so ` +
                    'every task hash differs and the baked cache is dead weight'
            ).toBe(service.get(name))
        }
    })
})


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
                    packages: ['apps/**', 'packages/**', 'tooling/**'],
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
            // Packages and tooling must stay: the union is built from them.
            expect(manifest.workspaces.packages).toContain('packages/**')
            expect(manifest.workspaces.packages).toContain('tooling/**')
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
                'packages/infrastructure/logger': { name: '@deployer/logger' },
            })
            const out = join(root, 'out')
            const runner = new TurboRunner()

            runner.linkOutputs(
                root,
                [member('@deployer/logger', 'packages/infrastructure/logger')],
                out
            )

            // Without the manifest the published .mjs resolves nothing: the
            // exports map that maps subpaths onto files lives in this file.
            expect(
                existsSync(join(out, 'packages/@deployer/logger/package.json'))
            ).toBe(true)
            // The package's own dist is now a link into the volume. The volume
            // target starts empty — Turbo fills it — so assert the link, not
            // its contents.
            const published = join(out, 'packages/@deployer/logger/dist')
            expect(existsSync(published)).toBe(true)
            expect(lstatSync(published).isDirectory()).toBe(true)
        })

        it('links the package tree into the volume so bare imports resolve', () => {
            const root = repo({
                'packages/infrastructure/logger': { name: '@deployer/logger' },
            })
            mkdirSync(join(root, 'packages/infrastructure/logger/node_modules'), {
                recursive: true,
            })
            const out = join(root, 'out')
            const runner = new TurboRunner()

            runner.linkOutputs(
                root,
                [member('@deployer/logger', 'packages/infrastructure/logger')],
                out
            )

            // A published file importing `rxjs` walks UP from its own directory;
            // this link is what makes that walk find the package's own tree.
            const linked = join(out, 'packages/@deployer/logger/node_modules')
            expect(existsSync(linked)).toBe(true)
            expect(
                readFileSync(
                    join(root, 'packages/infrastructure/logger/package.json'),
                    'utf8'
                )
            ).toContain('@deployer/logger')
        })

        it('skips packages with no build script, matching what it links', () => {
            const root = repo({
                'tooling/typescript': {
                    name: '@deployer/config-typescript',
                    build: false,
                },
            })
            const out = join(root, 'out')
            const runner = new TurboRunner()

            runner.linkOutputs(
                root,
                [
                    member(
                        '@deployer/config-typescript',
                        'tooling/typescript'
                    ),
                ],
                out
            )

            expect(
                existsSync(join(out, 'packages/@deployer/config-typescript/dist'))
            ).toBe(false)
        })

        it('keeps dist a symlink into the volume across runs', () => {
            const root = repo({
                'packages/infrastructure/logger': { name: '@deployer/logger' },
            })
            const out = join(root, 'out')
            const runner = new TurboRunner()
            const union = [member('@deployer/logger', 'packages/infrastructure/logger')]
            const link = join(root, 'packages/infrastructure/logger/dist')

            runner.linkOutputs(root, union, out)
            expect(lstatSync(link).isSymbolicLink()).toBe(true)

            runner.linkOutputs(root, union, out)

            // A real directory here is the failure mode: it detaches the package
            // from the volume and every later write lands in the repo instead.
            expect(lstatSync(link).isSymbolicLink()).toBe(true)
            expect(realpathSync(link)).toBe(
                realpathSync(join(out, 'packages/@deployer/logger/dist'))
            )
        })
    })

    describe('adopting the image-built output', () => {
        it('copies a real dist into the volume instead of discarding it', () => {
            const root = repo({
                'packages/infrastructure/logger': { name: '@deployer/logger' },
            })
            const out = join(root, 'out')
            const runner = new TurboRunner()

            // The fixture writes a real `dist/index.mjs`, which is exactly the
            // state the Dockerfile leaves behind. Deleting it would throw away a
            // finished build and force the operator's first run to redo it.
            runner.linkOutputs(
                root,
                [member('@deployer/logger', 'packages/infrastructure/logger')],
                out
            )

            expect(
                readFileSync(
                    join(out, 'packages/@deployer/logger/dist/index.mjs'),
                    'utf8'
                )
            ).toContain('export const x = 1')
        })

        it('reports COMPLETE when the image built every package', () => {
            const root = repo({
                'packages/a': { name: '@deployer/a' },
                'packages/b': { name: '@deployer/b' },
            })
            const runner = new TurboRunner()

            const published = runner.linkOutputs(
                root,
                [member('@deployer/a', 'packages/a'), member('@deployer/b', 'packages/b')],
                join(root, 'out')
            )

            // This is what lets the command skip its build entirely on a first run.
            expect(published).toBe(true)
        })

        it('reports INCOMPLETE when a package has not been built', () => {
            // The fixture omits `dist/` for a package with a build script only
            // when told to; shaping that here means removing it after creation.
            const root = repo({ 'packages/a': { name: '@deployer/a' } })
            rmSync(join(root, 'packages/a/dist'), { recursive: true, force: true })
            const runner = new TurboRunner()

            const published = runner.linkOutputs(
                root,
                [member('@deployer/a', 'packages/a')],
                join(root, 'out')
            )

            // Something is missing, so the caller must still build.
            expect(published).toBe(false)
        })

        it('does NOT overwrite artifacts a previous run already published', () => {
            const root = repo({
                'packages/a': { name: '@deployer/a' },
            })
            const out = join(root, 'out')
            const runner = new TurboRunner()
            const union = [member('@deployer/a', 'packages/a')]

            // A previous run published a newer artifact into the surviving volume.
            mkdirSync(join(out, 'packages/@deployer/a/dist'), { recursive: true })
            writeFileSync(
                join(out, 'packages/@deployer/a/dist/index.mjs'),
                'export const NEWER = 1\n'
            )

            runner.linkOutputs(root, union, out)

            // The volume outlives the container, so its content must win over the
            // older image output — otherwise a restart would silently roll back.
            expect(
                readFileSync(
                    join(out, 'packages/@deployer/a/dist/index.mjs'),
                    'utf8'
                )
            ).toContain('NEWER')
        })
    })
})
