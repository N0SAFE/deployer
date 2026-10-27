import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { rewriteDeclarationAliases } from './declaration-aliases'

const cleanups: string[] = []

/**
 * Materialize a package-shaped tree: `src/` (the source root) and `dist/types/`
 * (what `tsc` emitted), so the rewriter sees the layout it runs against.
 */
function fixture(
    sources: Record<string, string>,
    declarations: Record<string, string>
): { rootDir: string; typesDir: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decl-alias-'))
    cleanups.push(dir)
    const rootDir = path.join(dir, 'src')
    const typesDir = path.join(dir, 'dist', 'types')

    for (const [base, files] of [
        [rootDir, sources],
        [typesDir, declarations],
    ] as const) {
        for (const [rel, content] of Object.entries(files)) {
            const abs = path.join(base, rel)
            fs.mkdirSync(path.dirname(abs), { recursive: true })
            fs.writeFileSync(abs, content)
        }
    }
    return { rootDir, typesDir }
}

afterEach(() => {
    while (cleanups.length > 0) {
        fs.rmSync(cleanups.pop()!, { recursive: true, force: true })
    }
})

describe('rewriteDeclarationAliases', () => {
    it('rewrites an alias to the relative path of the emitted declaration', () => {
        const { rootDir, typesDir } = fixture(
            { 'entities/foo.ts': '', 'entities/bar.ts': '' },
            {
                'entities/bar.d.ts': "export * from '@/entities/foo'\n",
                'entities/foo.d.ts': 'export declare const foo: 1\n',
            }
        )

        const stats = rewriteDeclarationAliases(typesDir, rootDir, [
            { prefix: '@/', target: rootDir },
        ])

        expect(stats.specifiers).toBe(1)
        expect(stats.files).toBe(1)
        expect(fs.readFileSync(path.join(typesDir, 'entities/bar.d.ts'), 'utf8')).toBe(
            "export * from './foo'\n"
        )
    })

    it('rewrites a nested alias to the correct relative hop', () => {
        const { rootDir, typesDir } = fixture(
            { 'a/b/c.ts': '', 'a/target.ts': '' },
            {
                'a/b/c.d.ts': "import { x } from '@/a/target'\n",
                'a/target.d.ts': 'export declare const x: 1\n',
            }
        )

        rewriteDeclarationAliases(typesDir, rootDir, [
            { prefix: '@/', target: rootDir },
        ])

        expect(fs.readFileSync(path.join(typesDir, 'a/b/c.d.ts'), 'utf8')).toBe(
            "import { x } from '../target'\n"
        )
    })

    it('resolves a directory alias through its index declaration', () => {
        const { rootDir, typesDir } = fixture(
            { 'entities/foo/index.ts': '', 'index.ts': '' },
            {
                'index.d.ts': "export * from '@/entities/foo'\n",
                'entities/foo/index.d.ts': 'export declare const foo: 1\n',
            }
        )

        rewriteDeclarationAliases(typesDir, rootDir, [
            { prefix: '@/', target: rootDir },
        ])

        expect(fs.readFileSync(path.join(typesDir, 'index.d.ts'), 'utf8')).toBe(
            "export * from './entities/foo'\n"
        )
    })

    it('covers every specifier form tsc emits', () => {
        const { rootDir, typesDir } = fixture(
            { 'target.ts': '', 'a.ts': '' },
            {
                'a.d.ts': [
                    "export * from '@/target'",
                    "import type { T } from '@/target'",
                    "export type U = import('@/target').T",
                    "import '@/target'",
                    '',
                ].join('\n'),
                'target.d.ts': 'export declare const t: 1\nexport type T = number\n',
            }
        )

        const stats = rewriteDeclarationAliases(typesDir, rootDir, [
            { prefix: '@/', target: rootDir },
        ])

        expect(stats.specifiers).toBe(4)
        const out = fs.readFileSync(path.join(typesDir, 'a.d.ts'), 'utf8')
        expect(out).not.toContain('@/')
        expect(out).toContain("export * from './target'")
        expect(out).toContain("export type U = import('./target').T")
        expect(out).toContain("import './target'")
    })

    it('leaves example imports inside JSDoc alone', () => {
        const { rootDir, typesDir } = fixture(
            { 'options.ts': '' },
            {
                'a.d.ts': [
                    '/**',
                    " * import { authClient } from '@/client/options'",
                    ' */',
                    "export declare const a: import('@/options').X",
                    '',
                ].join('\n'),
                'options.d.ts': 'export type X = 1\n',
            }
        )

        rewriteDeclarationAliases(typesDir, rootDir, [
            { prefix: '@/', target: rootDir },
        ])

        const out = fs.readFileSync(path.join(typesDir, 'a.d.ts'), 'utf8')
        // The doc comment is prose and stays; the real specifier is rewritten.
        expect(out).toContain("from '@/client/options'")
        expect(out).toContain("import('./options')")
    })

    it('leaves a package-name import untouched and does not report it', () => {
        const { rootDir, typesDir } = fixture(
            { 'index.ts': '' },
            { 'index.d.ts': "export * from '@deployer/type-guards'\n" }
        )

        const stats = rewriteDeclarationAliases(typesDir, rootDir, [
            { prefix: '@/', target: rootDir },
        ])

        expect(stats.specifiers).toBe(0)
        expect(stats.unresolved).toEqual([])
        expect(fs.readFileSync(path.join(typesDir, 'index.d.ts'), 'utf8')).toBe(
            "export * from '@deployer/type-guards'\n"
        )
    })

    it('reports an alias that names no emitted declaration', () => {
        const { rootDir, typesDir } = fixture(
            { 'index.ts': '' },
            { 'index.d.ts': "export * from '@/does/not/exist'\n" }
        )

        const stats = rewriteDeclarationAliases(typesDir, rootDir, [
            { prefix: '@/', target: rootDir },
        ])

        expect(stats.specifiers).toBe(0)
        expect(stats.unresolved).toEqual(['@/does/not/exist'])
    })

    it('does nothing when the package declares no source alias', () => {
        const { rootDir, typesDir } = fixture(
            { 'index.ts': '' },
            { 'index.d.ts': "export * from '@/index'\n" }
        )

        const stats = rewriteDeclarationAliases(typesDir, rootDir, [])

        expect(stats).toEqual({ files: 0, specifiers: 0, unresolved: [] })
        expect(fs.readFileSync(path.join(typesDir, 'index.d.ts'), 'utf8')).toBe(
            "export * from '@/index'\n"
        )
    })

    it('is idempotent — a second pass finds no alias', () => {
        const { rootDir, typesDir } = fixture(
            { 'target.ts': '', 'a.ts': '' },
            {
                'a.d.ts': "export * from '@/target'\n",
                'target.d.ts': 'export declare const t: 1\n',
            }
        )
        const aliases = [{ prefix: '@/', target: rootDir }]

        expect(rewriteDeclarationAliases(typesDir, rootDir, aliases).specifiers).toBe(1)
        expect(rewriteDeclarationAliases(typesDir, rootDir, aliases).specifiers).toBe(0)
    })

    it('handles a self-name alias that maps to the source root', () => {
        const { rootDir, typesDir } = fixture(
            { 'client/options.ts': '' },
            {
                'client/options.d.ts': 'export declare const o: 1\n',
                'index.d.ts': "export * from '@deployer/auth/client/options'\n",
            }
        )

        rewriteDeclarationAliases(typesDir, rootDir, [
            { prefix: '@deployer/auth/', target: rootDir },
        ])

        expect(fs.readFileSync(path.join(typesDir, 'index.d.ts'), 'utf8')).toBe(
            "export * from './client/options'\n"
        )
    })

    it('leaves a self-name specifier alone when its alias is not registered', () => {
        // `sourceAliases` drops a target that escapes the source root, so a
        // package-name import stays as authored and resolves through `exports`.
        const { rootDir, typesDir } = fixture(
            { 'index.ts': '' },
            { 'index.d.ts': "export * from '@deployer/auth/client/options'\n" }
        )

        const stats = rewriteDeclarationAliases(typesDir, rootDir, [])

        expect(stats.specifiers).toBe(0)
        expect(fs.readFileSync(path.join(typesDir, 'index.d.ts'), 'utf8')).toBe(
            "export * from '@deployer/auth/client/options'\n"
        )
    })
})
