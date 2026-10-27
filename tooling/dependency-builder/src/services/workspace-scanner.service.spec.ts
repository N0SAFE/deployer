import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { WorkspaceScanner } from './workspace-scanner.service'

/**
 * Where workspaces are DISCOVERED.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * A whole `compose up` failed because discovery depended on the root manifest's
 * `workspaces.packages` globs, and something else had rewritten them:
 *
 *   [ApplicationDetector] Enabled applications (from COMPOSE_PROFILES="all"):
 *   UnknownWorkspaceError: Workspace "(none)" is not part of the repository.
 *     Known workspaces: @deployer/nest-swarm, @deployer/nest-schema, …
 *
 * The list named only `packages/**` workspaces — `apps/**` had been stripped
 * from the globs, so no application was findable and `all` resolved to nothing.
 *
 * The rule these tests pin: DISCOVERY must not depend on a glob another
 * component may legitimately rewrite. The conventional trees are always scanned.
 */

/** The repository's conventional workspace trees. */
const TREES = ['apps', 'packages', 'tooling'] as const

function makeRepo(
    packages: Record<string, string>,
    globs: readonly string[]
): string {
    const root = mkdtempSync(join(tmpdir(), 'scanner-'))

    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify(
            {
                name: 'root',
                private: true,
                workspaces: { packages: [...globs] },
            },
            null,
            4
        )
    )

    for (const [dir, name] of Object.entries(packages)) {
        mkdirSync(join(root, dir), { recursive: true })
        writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name }))
    }

    return root
}

describe('WorkspaceScanner', () => {
    const roots: string[] = []

    afterEach(() => {
        for (const root of roots.splice(0))
            rmSync(root, { recursive: true, force: true })
    })

    function repo(
        packages: Record<string, string>,
        globs: readonly string[] = [...TREES].map((t) => `${t}/**`)
    ): string {
        const root = makeRepo(packages, globs)
        roots.push(root)
        return root
    }

    it('finds a workspace in every conventional tree', () => {
        const root = repo({
            'apps/api': '@deployer/api',
            'packages/utils/errors': '@deployer/errors',
            'tooling/prettier': '@deployer/config-prettier',
        })

        const { workspaces } = new WorkspaceScanner().scan(root)

        expect([...workspaces.keys()].sort()).toEqual([
            '@deployer/api',
            '@deployer/config-prettier',
            '@deployer/errors',
        ])
    })

    it('still finds applications when the globs have been stripped of `apps`', () => {
        // EXACTLY the state `TurboRunner.excludeApplicationsFromGraph` leaves the
        // manifest in. Discovery must survive it: the union is computed for
        // enabled APPLICATIONS, so failing to find them is fatal.
        const root = repo(
            {
                'apps/api': '@deployer/api',
                'packages/utils/errors': '@deployer/errors',
            },
            ['packages/**', 'tooling/**']
        )

        const { workspaces } = new WorkspaceScanner().scan(root)

        expect(workspaces.has('@deployer/api')).toBe(true)
        expect(workspaces.has('@deployer/errors')).toBe(true)
    })

    it('finds applications even when the manifest declares no globs at all', () => {
        const root = repo({ 'apps/web': '@deployer/web' }, [])

        const { workspaces } = new WorkspaceScanner().scan(root)

        expect(workspaces.has('@deployer/web')).toBe(true)
    })

    it('discovers a workspace nested inside another workspace', () => {
        // `tooling/eslint` is a workspace AND contains one
        // (`tooling/eslint/plugins/progress`). Stopping at the first
        // `package.json` silently omits the nested one, for every application.
        const root = repo({
            'tooling/eslint': '@deployer/config-eslint',
            'tooling/eslint/plugins/progress':
                '@deployer/config-eslint-plugins-progress',
        })

        const { workspaces } = new WorkspaceScanner().scan(root)

        expect(workspaces.has('@deployer/config-eslint')).toBe(true)
        expect(
            workspaces.has('@deployer/config-eslint-plugins-progress')
        ).toBe(true)
    })

    it('records internal dependency edges between discovered workspaces', () => {
        const root = repo({
            'apps/api': '@deployer/api',
            'packages/utils/errors': '@deployer/errors',
        })
        writeFileSync(
            join(root, 'apps/api/package.json'),
            JSON.stringify({
                name: '@deployer/api',
                dependencies: { '@deployer/errors': '*', zod: '^4' },
            })
        )

        const { workspaces } = new WorkspaceScanner().scan(root)

        // `zod` is external and must not appear as an edge; the internal
        // workspace must, because the union is walked along these edges.
        expect(workspaces.get('@deployer/api')?.internalDeps).toEqual([
            '@deployer/errors',
        ])
    })

    it('throws when the repository contains no workspaces at all', () => {
        const root = repo({})

        expect(() => new WorkspaceScanner().scan(root)).toThrow(
            /no workspace manifests/i
        )
    })
})
