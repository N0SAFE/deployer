import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { PkgConfigService } from './pkg-config.service'

const cleanups: string[] = []

/**
 * Materialize a throwaway package: `package.json`, an optional
 * `pkg-build.config.ts`, and declared source files.
 *
 * The config is written as real source, not a JSON block, because that is the
 * only form the service reads — the legacy `pkgBuild` manifest key is rejected
 * outright, so a fixture carrying one would test a path that no longer exists.
 */
function fixture(files: Record<string, string>, config?: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-build-'))
    cleanups.push(dir)
    fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture' }, null, 4)
    )
    if (config !== undefined) {
        fs.writeFileSync(path.join(dir, 'pkg-build.config.ts'), config)
    }
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, content)
    }
    return dir
}

/** A config module with no imports, so it loads from any temp directory. */
function configModule(body: string): string {
    return `export default ${body}`
}

afterEach(() => {
    while (cleanups.length > 0) {
        fs.rmSync(cleanups.pop()!, { recursive: true, force: true })
    }
})

describe('PkgConfigService', () => {
    it('applies the documented defaults when no config file is present', async () => {
        const service = await PkgConfigService.create(
            fixture({ 'src/index.ts': '' })
        )

        expect(service.configFile).toBeUndefined()
        expect(service.config.root).toBe('src')
        expect(service.config.formats).toEqual(['esm', 'cjs'])
        expect(service.config.variants).toEqual(['production'])
        expect(service.config.outDir).toBe('dist')
        expect(service.config.target).toBe('bun')
        expect(service.config.keepEnv).toBe(true)
        expect(service.config.types).toBe(true)
        // Per-variant knobs stay unset so the builder applies the variant rule.
        expect(service.config.minify).toBeUndefined()
        expect(service.config.sourcemap).toBeUndefined()
    })

    it('reads the config file and records which one was loaded', async () => {
        const service = await PkgConfigService.create(
            fixture(
                { 'src/index.ts': '' },
                configModule(`{
                    root: 'lib',
                    outDir: 'build',
                    formats: ['esm'],
                    external: ['zod'],
                }`)
            )
        )

        expect(path.basename(service.configFile ?? '')).toBe(
            'pkg-build.config.ts'
        )
        expect(service.config.root).toBe('lib')
        expect(service.config.outDir).toBe('build')
        expect(service.config.formats).toEqual(['esm'])
        expect(service.config.external).toEqual(['zod'])
    })

    it('derives both JSX variants when the source contains .tsx', async () => {
        const service = await PkgConfigService.create(
            fixture({ 'src/index.ts': '', 'src/button.tsx': '' })
        )

        expect(service.config.variants).toEqual(['development', 'production'])
    })

    it('only minifies a production build of the production variant', async () => {
        // A non-JSX package emits a single `production` variant, so keying
        // minification off the variant alone would minify every dev build.
        const service = await PkgConfigService.create(
            fixture({ 'src/index.ts': '' })
        )

        expect(service.config.variants).toEqual(['production'])
        expect(service.minifyFor('dev', 'production')).toBe(false)
        expect(service.minifyFor('prod', 'production')).toBe(true)
        // The development variant stays readable even in a production build.
        expect(service.minifyFor('prod', 'development')).toBe(false)
    })

    it('only drops sourcemaps for a production build of the production variant', async () => {
        const service = await PkgConfigService.create(
            fixture({ 'src/index.ts': '' })
        )

        expect(service.sourcemapFor('dev', 'production')).toBe('linked')
        expect(service.sourcemapFor('prod', 'development')).toBe('linked')
        expect(service.sourcemapFor('prod', 'production')).toBe('none')
    })

    it('lets an explicit minify/sourcemap override the mode rule', async () => {
        const service = await PkgConfigService.create(
            fixture(
                { 'src/index.ts': '' },
                configModule(`{ minify: true, sourcemap: 'none' }`)
            )
        )

        expect(service.minifyFor('dev', 'production')).toBe(true)
        expect(service.sourcemapFor('dev', 'production')).toBe('none')
    })

    it('rejects a legacy pkgBuild block in package.json', async () => {
        const dir = fixture({ 'src/index.ts': '' })
        fs.writeFileSync(
            path.join(dir, 'package.json'),
            JSON.stringify({ name: 'fixture', pkgBuild: { root: 'src' } })
        )

        // `die()` exits the process. Stub `process.exit` to throw so the test can
        // observe the rejection instead of killing the runner.
        const previousExit = process.exit
        const previousError = console.error
        process.exit = ((code?: number) => {
            throw new Error(`exit:${String(code)}`)
        }) as typeof process.exit
        console.error = () => undefined
        try {
            await expect(PkgConfigService.create(dir)).rejects.toThrow('exit:1')
        } finally {
            process.exit = previousExit
            console.error = previousError
        }
    })

    it('treats explicit entries and include globs as a union, excluding tests', async () => {
        const service = await PkgConfigService.create(
            fixture(
                {
                    'src/index.ts': '',
                    'src/components/button.ts': '',
                    'src/hooks/use-thing.ts': '',
                    'src/components/button.spec.ts': '',
                    'src/scripts/cli.ts': '',
                },
                configModule(`{
                    entries: ['index.ts'],
                    include: ['components', 'hooks'],
                }`)
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

    it('collects authored .d.ts as ambient declarations, never as entries', async () => {
        const service = await PkgConfigService.create(
            fixture({
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

    it('honours formats: false and a flat output directory', async () => {
        const service = await PkgConfigService.create(
            fixture(
                { 'src/index.ts': '' },
                configModule(`{ formats: false, flat: true }`)
            )
        )

        expect(service.config.formats).toBe(false)
        expect(service.config.flat).toBe(true)
        expect(service.formatOutDir('cjs', 'production')).toBe(service.distDir)
    })

    it('lays variant output out as dist/<variant>/<format>', async () => {
        const service = await PkgConfigService.create(
            fixture(
                { 'src/index.ts': '' },
                configModule(`{ variants: ['development', 'production'] }`)
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
