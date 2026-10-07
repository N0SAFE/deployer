import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { PkgConfigService } from './pkg-config.service'

const cleanups: string[] = []

/** Materialize a throwaway package: `package.json` + declared source files. */
function fixture(
    pkgBuild: Record<string, unknown> | undefined,
    files: Record<string, string>
): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-build-'))
    cleanups.push(dir)
    fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture', pkgBuild }, null, 4)
    )
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, content)
    }
    return dir
}

afterEach(() => {
    while (cleanups.length > 0) {
        fs.rmSync(cleanups.pop()!, { recursive: true, force: true })
    }
})

describe('PkgConfigService', () => {
    it('applies the documented defaults when no pkgBuild block is present', () => {
        const service = new PkgConfigService(
            fixture(undefined, { 'src/index.ts': '' })
        )

        expect(service.config.root).toBe('src')
        expect(service.config.formats).toEqual(['esm', 'cjs'])
        expect(service.config.variants).toEqual(['production'])
        expect(service.config.outDir).toBe('dist')
        expect(service.config.target).toBe('bun')
        expect(service.config.keepEnv).toBe(true)
        expect(service.config.types).toBe(true)
    })

    it('derives both JSX variants when the source contains .tsx', () => {
        const service = new PkgConfigService(
            fixture(undefined, { 'src/index.ts': '', 'src/button.tsx': '' })
        )

        expect(service.config.variants).toEqual(['development', 'production'])
    })

    it('treats explicit entries and include globs as a union, excluding tests', () => {
        const service = new PkgConfigService(
            fixture(
                { entries: ['index.ts'], include: ['components', 'hooks'] },
                {
                    'src/index.ts': '',
                    'src/components/button.ts': '',
                    'src/hooks/use-thing.ts': '',
                    'src/components/button.spec.ts': '',
                    'src/scripts/cli.ts': '',
                }
            )
        )

        const entries = service
            .listEntries()
            .map((abs) => service.relative(abs))
            .sort()

        expect(entries).toEqual([
            'src/components/button.ts',
            'src/hooks/use-thing.ts',
            'src/index.ts',
        ])
    })

    it('collects authored .d.ts as ambient declarations, never as entries', () => {
        const service = new PkgConfigService(
            fixture(undefined, {
                'src/index.ts': '',
                'src/types/exceljs-dist.d.ts': 'declare module "exceljs";',
            })
        )

        expect(
            service.listEntries().map((abs) => service.relative(abs))
        ).toEqual(['src/index.ts'])
        expect(service.listAmbientDeclarations()).toEqual([
            'types/exceljs-dist.d.ts',
        ])
    })

    it('honours formats: false and a flat output directory', () => {
        const service = new PkgConfigService(
            fixture({ formats: false, flat: true }, { 'src/index.ts': '' })
        )

        expect(service.config.formats).toBe(false)
        expect(service.config.flat).toBe(true)
        expect(service.formatOutDir('cjs', 'production')).toBe(service.distDir)
    })

    it('lays variant output out as dist/<variant>/<format>', () => {
        const service = new PkgConfigService(
            fixture(
                { variants: ['development', 'production'] },
                { 'src/index.ts': '' }
            )
        )

        expect(service.formatOutDir('esm', 'production')).toBe(
            path.join(service.distDir, 'production', 'esm')
        )
        expect(
            service.entryOutPath(
                path.join(service.rootDir, 'a/b.ts'),
                'cjs',
                'development'
            )
        ).toBe(path.join(service.distDir, 'development', 'cjs', 'a/b.js'))
    })
})
