import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { WorkspaceScanner } from './workspace-scanner.service'
import { UnionPlanner } from './union-planner.service'

/**
 * The closure rule and its two non-obvious halves, encoded as a test.
 *
 * The rule was derived by measuring `turbo prune` for all four applications in
 * this repository (api 31, setup 29, web 21, doc 8). Both halves below were
 * found by a mismatched run first, so they are exactly the parts a future edit
 * is most likely to break:
 *
 *  - a nested workspace (a package that is itself a workspace AND contains one)
 *    must be discovered, or it silently disappears from every union
 *  - the ROOT manifest's internal devDependencies belong to every union, which
 *    is why `doc` needs `@repo/env` although nothing it declares depends on it
 */

/** Build a throwaway workspace tree and return its root. */
function makeRepo(manifests: Record<string, Record<string, unknown>>): string {
    const root = mkdtempSync(join(tmpdir(), 'dep-builder-'))

    for (const [dir, manifest] of Object.entries(manifests)) {
        const abs = dir === '.' ? root : join(root, dir)
        mkdirSync(abs, { recursive: true })
        writeFileSync(
            join(abs, 'package.json'),
            JSON.stringify(manifest, null, 2)
        )
    }

    return root
}

function plan(root: string, apps: string[], scanner = new WorkspaceScanner()) {
    return new UnionPlanner(scanner).plan(root, apps)
}

describe('UnionPlanner', () => {
    const roots: string[] = []

    afterEach(() => {
        for (const root of roots.splice(0))
            rmSync(root, { recursive: true, force: true })
    })

    function repo(manifests: Record<string, Record<string, unknown>>): string {
        const root = makeRepo(manifests)
        roots.push(root)
        return root
    }

    it('omits the application itself and the packages it does not use', () => {
        const root = repo({
            '.': {
                name: 'root',
                private: true,
                devDependencies: { '@repo/tooling': '*' },
            },
            'apps/api': { name: 'api', dependencies: { '@repo/shared': '*' } },
            'apps/web': { name: 'web', dependencies: { '@repo/widget': '*' } },
            'packages/shared': { name: '@repo/shared' },
            'packages/widget': { name: '@repo/widget' },
            'packages/tooling': { name: '@repo/tooling' },
        })

        const union = plan(root, ['api']).map((m) => m.name)

        // The application runs its own dev server, so it is not in its closure.
        expect(union).not.toContain('api')
        // A package only `web` needs must not leak in.
        expect(union).not.toContain('@repo/widget')
        expect(union).toEqual(['@repo/shared', '@repo/tooling'])
    })

    it('descends into a package that is itself a workspace', () => {
        const root = repo({
            '.': { name: 'root', private: true },
            'apps/api': {
                name: 'api',
                dependencies: { '@repo/nested-parent': '*' },
            },
            // A workspace, AND the parent of another workspace. This mirrors
            // `tooling/eslint`, which is a workspace and also contains
            // `plugins/progress`. The nested workspace is declared as a
            // dependency, exactly as the real one is.
            'packages/nested-parent': {
                name: '@repo/nested-parent',
                dependencies: { '@repo/nested-child': '*' },
            },
            'packages/nested-parent/plugins/child': {
                name: '@repo/nested-child',
                dependencies: { '@repo/deep': '*' },
            },
            'packages/deep': { name: '@repo/deep' },
        })

        const union = plan(root, ['api']).map((m) => m.name)

        // Reached by descending THROUGH nested-parent rather than stopping at it.
        expect(union).toContain('@repo/nested-child')
        expect(union).toContain('@repo/deep')
    })

    it("includes the root manifest's internal devDependencies for every application", () => {
        const root = repo({
            '.': {
                name: 'root',
                private: true,
                devDependencies: { '@repo/env': '*', typescript: '^5' },
            },
            'apps/doc': {
                name: 'doc',
                dependencies: { '@repo/type-guards': '*' },
            },
            'packages/type-guards': { name: '@repo/type-guards' },
            'packages/env': { name: '@repo/env' },
        })

        const union = plan(root, ['doc']).map((m) => m.name)

        // Nothing doc declares depends on @repo/env; only the root does.
        expect(union).toContain('@repo/env')
        expect(union).toContain('@repo/type-guards')
        // An external root devDependency is not a workspace, so it is excluded.
        expect(union).not.toContain('typescript')
    })

    it('lists a shared package once, naming every application that pulled it in', () => {
        const root = repo({
            '.': { name: 'root', private: true },
            'apps/api': { name: 'api', dependencies: { '@repo/shared': '*' } },
            'apps/web': {
                name: 'web',
                dependencies: { '@repo/shared': '*', '@repo/only-web': '*' },
            },
            'packages/shared': { name: '@repo/shared' },
            'packages/only-web': { name: '@repo/only-web' },
        })

        const union = plan(root, ['api', 'web'])
        const shared = union.filter((m) => m.name === '@repo/shared')

        expect(shared).toHaveLength(1)
        expect(shared[0]?.contributors).toEqual(['api', 'web'])
        expect(
            union.find((m) => m.name === '@repo/only-web')?.contributors
        ).toEqual(['web'])
    })

    it('rejects an application that is not a workspace, and names the known ones', () => {
        const root = repo({
            '.': { name: 'root', private: true },
            'apps/api': { name: 'api' },
        })

        expect(() => plan(root, ['nope'])).toThrow(
            /"nope" is not part of the repository/
        )
    })

    it("includes the tool's own internal dependencies", () => {
        const root = repo({
            '.': { name: 'root', private: true },
            'apps/api': { name: 'api', dependencies: { '@repo/shared': '*' } },
            'packages/shared': { name: '@repo/shared' },
            'packages/logger': { name: '@repo/logger' },
            'tooling/dependency-builder': {
                name: '@repo/dependency-builder',
                dependencies: { '@repo/logger': '*' },
            },
        })

        const union = plan(root, ['api'])

        // The tool resolves @repo/* at runtime, so its deps must be built too.
        const logger = union.find((m) => m.name === '@repo/logger')
        expect(logger).toBeDefined()
        expect(logger?.contributors).toEqual(['dependency-builder'])
        // It is not itself part of the union: it runs from source.
        expect(union.map((m) => m.name)).not.toContain(
            '@repo/dependency-builder'
        )
    })

    it('marks a package shared by an application and the tool', () => {
        const root = repo({
            '.': { name: 'root', private: true },
            'apps/api': { name: 'api', dependencies: { '@repo/logger': '*' } },
            'packages/logger': { name: '@repo/logger' },
            'tooling/dependency-builder': {
                name: '@repo/dependency-builder',
                dependencies: { '@repo/logger': '*' },
            },
        })

        const union = plan(root, ['api'])
        const logger = union.filter((m) => m.name === '@repo/logger')

        expect(logger).toHaveLength(1)
        expect(logger[0]?.contributors).toEqual(['api', 'dependency-builder'])
    })
})
