import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readLedger } from '../rules/nest-roles-ledger'

/** An app: `src/a.ts` and a ledger next to where its eslint config would be. */
function app(ledger: unknown) {
    const root = mkdtempSync(join(tmpdir(), 'ledger-'))
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/a.ts'), 'export {};\n')
    writeFileSync(join(root, 'nest-roles.ledger.json'), JSON.stringify(ledger))
    return { root, ledger: join(root, 'nest-roles.ledger.json') }
}

describe('readLedger', () => {
    it('is empty when there is no ledger', () => {
        expect(readLedger(undefined)).toEqual({})
    })

    it('reads an absolute path whatever the working directory is — the hook lints from the repo root', () => {
        const { ledger } = app({ noInjectableService: ['src/a.ts'] })
        expect(process.cwd()).not.toBe(join(ledger, '..'))
        expect(readLedger(ledger)).toEqual({
            noInjectableService: ['src/a.ts'],
        })
    })

    it("resolves entries against the LEDGER's directory, not the working directory", () => {
        const { ledger } = app({ noNestGuard: ['src/a.ts'] })
        expect(() => readLedger(ledger)).not.toThrow()
    })

    it('fails the load for an entry whose file is gone, naming the rule and the entry', () => {
        const { ledger } = app({ noNestPipe: ['src/gone.ts'] })
        expect(() => readLedger(ledger)).toThrow(
            /src\/gone\.ts under noNestPipe, which no longer exists/
        )
    })

    it('rejects an unknown rule name and a non-array', () => {
        expect(() => readLedger(app({ noSuchRule: [] }).ledger)).toThrow(
            /not a valid ledger/
        )
        expect(() =>
            readLedger(app({ noNestGuard: 'src/a.ts' }).ledger)
        ).toThrow(/not a valid ledger/)
    })

    it('fails clearly when the ledger file is missing', () => {
        expect(() => readLedger('/nonexistent/nest-roles.ledger.json')).toThrow(
            /does not exist/
        )
    })
})
