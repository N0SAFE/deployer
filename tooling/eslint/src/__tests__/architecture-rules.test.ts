import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it, vi } from 'vitest'

import type { Facts } from '../rules/architecture/facts-schema'

/**
 * The rules' reactions to facts, with the facts process replaced by a controlled document — so every outcome that must be
 * LOUD (a file the gate could not analyse, a declaration it has no facts for, an unsaved buffer) is pinned without a compiler.
 */
let facts: Facts = { files: {}, globals: [], sites: {}, errors: {} }
vi.mock('../rules/architecture/facts-client', async (importOriginal) => ({
    ...(await importOriginal<
        typeof import('../rules/architecture/facts-client')
    >()),
    loadFacts: () => facts,
}))

const { default: architecture } = await import('../architecture')

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'architecture-rules-')))
const filename = join(dir, 'm.module.ts')

const CODE = `import { createModuleContext } from "x";
export const M = createModuleContext({ controllers: [Ctl], providers: [A, A], exports: [B] });
`
const callColumn = CODE.split('\n')[1].indexOf('createModuleContext')

function lint(code: string, onDisk = code) {
    writeFileSync(filename, onDisk)
    return new Linter({ cwd: dir }).verify(
        code,
        [
            {
                files: ['**/*.ts'],
                languageOptions: { parser: tseslint.parser },
                plugins: { 'deployer-effect': architecture },
                rules: {
                    'deployer-effect/requireModuleContext': 'error',
                    'deployer-effect/requirementFlow': 'error',
                },
            },
        ],
        { filename }
    )
}

const ids = (code: string, onDisk?: string) =>
    lint(code, onDisk).map((m) => m.messageId)
const withFacts = (
    patch: Partial<Facts> & {
        calls?: Facts['files'][string]['calls']
        bare?: string[]
    }
): Facts => ({
    files: {
        [filename]: {
            bare: patch.bare ?? [],
            calls: patch.calls ?? [
                {
                    start: { line: 2, column: callColumn },
                    module: 'M',
                    pairs: [],
                },
            ],
        },
    },
    globals: patch.globals ?? [],
    sites: patch.sites ?? {},
    errors: patch.errors ?? {},
})

describe('requirementFlow', () => {
    it('is quiet for a clean analysed module (the syntactic checks still run)', () => {
        facts = withFacts({})
        expect(ids(CODE)).toEqual(['duplicateProvider', 'unknownExport'])
    })

    it('reports an unmet requirement on the owning entry, once per missing service', () => {
        facts = withFacts({
            calls: [
                {
                    start: { line: 2, column: callColumn },
                    module: 'M',
                    pairs: [
                        ['Ctl', 'Dep'],
                        ['Ctl', 'Other'],
                    ],
                },
            ],
        })
        const found = lint(CODE).filter(
            (m) => m.messageId === 'missingDependency'
        )
        expect(found).toHaveLength(2)
        expect(found[0]?.message).toContain(
            '`Ctl` requires `Dep`, but module `M`'
        )
        expect(found[0]?.line).toBe(2)
    })

    it('does not report a requirement a global module provides', () => {
        facts = withFacts({
            calls: [
                {
                    start: { line: 2, column: callColumn },
                    module: 'M',
                    pairs: [['Ctl', 'Dep']],
                },
            ],
            globals: ['Dep'],
        })
        expect(ids(CODE)).not.toContain('missingDependency')
    })

    it('reports the gap in the file that uses the service', () => {
        facts = withFacts({
            sites: {
                [filename]: [
                    {
                        start: { line: 1, column: 9 },
                        end: { line: 1, column: 29 },
                        owner: 'Svc',
                        missing: 'Dep',
                        module: 'M',
                        moduleFile: '/r/apps/x/m.module.ts',
                    },
                ],
            },
        })
        const here = lint(CODE).find(
            (m) => m.messageId === 'missingDependencyHere'
        )
        expect(here).toMatchObject({ line: 1, column: 10, endColumn: 30 })
        expect(here?.message).toContain('`Dep` is required here by `Svc`')
    })

    it('is an error when the gate could not analyse the file', () => {
        facts = withFacts({
            errors: { [filename]: ['it is not part of any tsconfig project'] },
        })
        const failed = lint(CODE).find((m) => m.messageId === 'analysisFailed')
        expect(failed?.message).toContain('not part of any tsconfig project')
    })

    it('is an error — not a pass — for a module declaration it has no facts for', () => {
        facts = { files: {}, globals: [], sites: {}, errors: {} }
        expect(ids(CODE)).toContain('noFacts')
    })

    it('reports only the failure, not a second noFacts, when the file failed analysis', () => {
        facts = {
            files: {},
            globals: [],
            sites: {},
            errors: { [filename]: ['boom'] },
        }
        const result = ids(CODE)
        expect(result).toContain('analysisFailed')
        expect(result).not.toContain('noFacts')
    })

    it('is an error when the file was analysed but this call has no facts (the two sides disagree on its position)', () => {
        facts = withFacts({
            calls: [{ start: { line: 9, column: 9 }, module: 'M', pairs: [] }],
        })
        expect(ids(CODE)).toContain('unanalysedCall')
    })

    it('stays quiet on an unsaved buffer: facts describe the disk, and positions would be wrong', () => {
        facts = withFacts({
            calls: [
                {
                    start: { line: 9, column: 9 },
                    module: 'M',
                    pairs: [['Ctl', 'Dep']],
                },
            ],
        })
        expect(ids(CODE, CODE + '// edited\n')).toEqual([])
    })
})

describe('requireModuleContext', () => {
    const BARE = `import { Module } from "@nestjs/common";\n@Module({})\nexport class Legacy {}\n`

    it('reports a bare @Module', () => {
        facts = withFacts({ bare: ['Legacy'], calls: [] })
        expect(ids(BARE)).toEqual(['bareModule'])
    })

    it('passes a @Module the facts say is declared', () => {
        facts = withFacts({ bare: [], calls: [] })
        expect(ids(BARE)).toEqual([])
    })

    it("is an error when the @Module's file has no facts", () => {
        facts = { files: {}, globals: [], sites: {}, errors: {} }
        expect(ids(BARE)).toEqual(['noFacts'])
    })

    it('ignores a class that is not a module', () => {
        facts = { files: {}, globals: [], sites: {}, errors: {} }
        expect(ids('export class Plain {}\n')).toEqual([])
    })
})
