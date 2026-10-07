import { Injectable } from '@nestjs/common'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { die } from '../utils/errors'
import { walkFiles } from '../utils/glob'
import { readJson } from '../utils/json'

export type Format = 'esm' | 'cjs'
export type Variant = 'development' | 'production'

export interface PkgBuildConfig {
    root: string
    entries?: string[]
    include?: string[]
    formats: Format[] | false
    variants: Variant[]
    outDir: string
    flat: boolean
    target: 'bun' | 'node' | 'browser'
    splitting?: boolean
    minify: boolean
    sourcemap: 'linked' | 'external' | 'inline' | 'none'
    external: string[]
    copy: { from: string; to: string }[]
    keepEnv: boolean
    types: boolean
}

/**
 * Package configuration and layout.
 *
 * Reads the consuming package's `package.json` (the CLI runs with the package
 * as cwd) and derives everything the builder needs: the effective `pkgBuild`
 * config, the entry set, the output layout, and where declarations go.
 *
 * Defaults (no `pkgBuild` block needed):
 *   root:      "src"
 *   entries:   every `src/**\/*.{ts,tsx}` except tests
 *   formats:   esm -> dist/esm/*.mjs, cjs -> dist/cjs/*.js
 *   target:    bun
 *   splitting: on for esm only (bun refuses splitting for cjs)
 *   types:     dist/types/**\/*.d.ts — `exports.types` points there, so
 *              consumers type-check declarations instead of package sources
 *
 * Config reference (`package.json` -> `"pkgBuild"`):
 *   root        string    Source directory. "." means the package root.
 *   entries     string[]  Explicit entry files (relative to root). Default: glob.
 *   include     string[]  Only build these sub-paths of root.
 *   formats     {esm?, cjs?} | false   Which formats to emit. `false` = none.
 *   variants    string[]  "development" | "production". Default ["production"].
 *                         Two entries produce dist/<variant>/<format> and are
 *                         selected by the consumer's export conditions.
 *   outDir      string    Base output dir. Default "dist".
 *   flat        boolean   Emit directly into outDir instead of outDir/<format>.
 *   target      string    bun | node | browser. Default "bun".
 *   splitting   boolean   Override code splitting.
 *   minify      boolean   Minify output.
 *   sourcemap   string    linked | external | inline | none.
 *   external    string[]  Extra external specifiers.
 *   copy        {from,to}[]  Extra assets to copy into the output.
 *   keepEnv     boolean   Keep `process.env.X` a runtime lookup (default true).
 *   types       boolean   Emit declarations to `dist/types`. Default true; set
 *                         false for a package that must not ship declarations.
 */
@Injectable()
export class PkgConfigService {
    readonly pkgRoot: string
    readonly manifest: Record<string, unknown>
    readonly config: PkgBuildConfig
    readonly rootDir: string
    readonly distDir: string

    /**
     * Declarations live in one layout-independent tree, keyed by source path:
     * `src/a/b.ts` -> `dist/types/a/b.d.ts`. Formats and JSX variants select
     * runtime code only, so they share a single declarations tree.
     */
    readonly typesDir: string

    /**
     * Generated tsconfig for the declaration pass.
     *
     * Written beside `package.json` (not in a temp directory) so
     * `extends: "./tsconfig.json"` and every `paths` entry it carries resolve
     * exactly as they do for the package's own `type-check`. Removed after the
     * compiler exits.
     */
    readonly typesTsconfig: string

    private readonly raw: Record<string, unknown>

    constructor(pkgRoot: string = process.cwd()) {
        this.pkgRoot = pkgRoot
        this.manifest = readJson(path.join(pkgRoot, 'package.json'))
        this.raw = (this.manifest.pkgBuild ?? {}) as Record<string, unknown>
        this.config = this.resolveConfig()
        this.rootDir = path.resolve(pkgRoot, this.config.root)
        this.distDir = path.resolve(pkgRoot, this.config.outDir)
        this.typesDir = path.join(this.distDir, 'types')
        this.typesTsconfig = path.join(
            pkgRoot,
            '.pkg-build-types.tsconfig.json'
        )
    }

    /** Test files are never part of a published surface. */
    isTest(rel: string): boolean {
        return (
            /\.(test|spec)\.tsx?$/.test(rel) ||
            /(^|\/)(__tests__|__mocks__|tests)\//.test(rel)
        )
    }

    /**
     * Does the package contain JSX?
     *
     * JSX compiles against `react/jsx-runtime` (prod) or `react/jsx-dev-runtime`
     * (dev), and that choice is baked into the emitted file. React's production
     * `jsx-dev-runtime` exports `jsxDEV = void 0`, so a JSX package built only with
     * the dev runtime throws `(0, jsxDEV) is not a function` the moment a production
     * consumer prerenders it.
     *
     * Therefore a JSX package must ship BOTH runtimes and let the consumer's
     * bundler select one through export conditions. This is detected rather than
     * declared: opting in per package is easy to forget, and the failure only
     * surfaces in a consumer's production build.
     */
    containsJsx(sourceDir: string): boolean {
        if (!fs.existsSync(sourceDir)) return false
        for (const rel of walkFiles(sourceDir, (r) => r.endsWith('.tsx'))) {
            if (!this.isTest(rel)) return true
        }
        return false
    }

    /** Resolve the effective config: defaults, then the package's overrides. */
    private resolveConfig(): PkgBuildConfig {
        const formatsRaw = this.raw.formats
        let formats: Format[] | false
        if (formatsRaw === false) {
            formats = false
        } else if (Array.isArray(formatsRaw)) {
            formats = formatsRaw.filter(
                (f): f is Format => f === 'esm' || f === 'cjs'
            )
        } else if (formatsRaw && typeof formatsRaw === 'object') {
            const obj = formatsRaw as Record<string, unknown>
            formats = (['esm', 'cjs'] as const).filter((f) => obj[f] !== false)
        } else {
            formats = ['esm', 'cjs']
        }

        const rootDirResolved = path.resolve(
            this.pkgRoot,
            typeof this.raw.root === 'string' ? this.raw.root : 'src'
        )

        // Variants are derived from JSX presence unless explicitly overridden.
        // A JSX package needs both runtimes (see `containsJsx`); a non-JSX package
        // has nothing to vary and ships a single production build.
        const variantsRaw = this.raw.variants
        const explicitVariants = Array.isArray(variantsRaw)
            ? variantsRaw.filter(
                  (v): v is Variant => v === 'development' || v === 'production'
              )
            : []
        const variants: Variant[] =
            explicitVariants.length > 0
                ? explicitVariants
                : this.containsJsx(rootDirResolved)
                  ? ['development', 'production']
                  : ['production']

        return {
            root: typeof this.raw.root === 'string' ? this.raw.root : 'src',
            entries: Array.isArray(this.raw.entries)
                ? (this.raw.entries as string[])
                : undefined,
            include: Array.isArray(this.raw.include)
                ? (this.raw.include as string[])
                : undefined,
            formats,
            variants: variants.length > 0 ? variants : ['production'],
            outDir:
                typeof this.raw.outDir === 'string' ? this.raw.outDir : 'dist',
            flat: this.raw.flat === true,
            target: (this.raw.target as PkgBuildConfig['target']) ?? 'bun',
            splitting:
                typeof this.raw.splitting === 'boolean'
                    ? this.raw.splitting
                    : undefined,
            minify: this.raw.minify === true,
            sourcemap:
                (this.raw.sourcemap as PkgBuildConfig['sourcemap']) ?? 'linked',
            external: Array.isArray(this.raw.external)
                ? (this.raw.external as string[])
                : [],
            copy: Array.isArray(this.raw.copy)
                ? (this.raw.copy as PkgBuildConfig['copy'])
                : [],
            keepEnv: this.raw.keepEnv !== false,
            types: this.raw.types !== false,
        }
    }

    /**
     * Collect entry points.
     *
     * `entries` and the glob scan are a **union**: explicit entries are always
     * built, and `include` narrows the glob (default: the whole root). That covers
     * both shapes in this repo — a package that builds everything, and one that
     * builds selected subdirectories plus its root index.
     *
     * Every source file is an entry so `dist/` mirrors the source tree, which is
     * what makes subpath exports like `./react/session/client` work.
     */
    listEntries(): string[] {
        if (!fs.existsSync(this.rootDir))
            die(`Source root not found: ${this.config.root}`)

        const entries = new Set<string>()

        for (const rel of this.config.entries ?? []) {
            const abs = path.resolve(this.rootDir, rel)
            if (!fs.existsSync(abs))
                die(`Entry not found: ${path.relative(this.pkgRoot, abs)}`)
            entries.add(abs)
        }

        // The glob runs for `include` subdirs, or over the whole root when neither
        // `entries` nor `include` is given. Explicit `entries` alone must not drag
        // in unrelated root files (configs, scripts).
        const scanDirs =
            this.config.include ??
            (this.config.entries === undefined ? [''] : [])

        for (const sub of scanDirs) {
            const base = path.join(this.rootDir, sub)
            if (!fs.existsSync(base)) continue
            for (const rel of walkFiles(base, (r) => /\.tsx?$/.test(r))) {
                if (rel.endsWith('.d.ts') || this.isTest(rel)) continue
                entries.add(path.join(base, rel))
            }
        }

        if (entries.size === 0) {
            die(
                `No entry points found under ${path.relative(this.pkgRoot, this.rootDir)}`
            )
        }
        return [...entries]
    }

    /**
     * Locate the TypeScript compiler for the declarations pass.
     *
     * Every package carries `typescript` in devDependencies for its `type-check`
     * script, so the nearest `node_modules/.bin/tsc` (native TS7) is the normal
     * hit. The PATH lookup is the fallback for pruned layouts.
     */
    resolveTsc(): string {
        let dir = this.pkgRoot
        for (;;) {
            const candidate = path.join(dir, 'node_modules', '.bin', 'tsc')
            if (fs.existsSync(candidate)) return candidate
            const parent = path.dirname(dir)
            if (parent === dir) break
            dir = parent
        }
        const onPath = Bun.which('tsc')
        if (onPath !== null) return onPath
        return die(
            'types build requires tsc — add typescript to devDependencies'
        )
    }

    /**
     * Source `.d.ts` files are inputs, not outputs: `tsc` never emits them, yet
     * consumers must see them. `@repo/ui` declares `exceljs/dist/exceljs.min.js`
     * this way. Collected from the same root as the JS build, skipping the output
     * tree so a rerun cannot copy generated declarations back onto themselves.
     */
    listAmbientDeclarations(): string[] {
        if (!this.config.types || !fs.existsSync(this.rootDir)) return []
        const outBase = path.basename(this.distDir)
        const found: string[] = []
        for (const rel of walkFiles(this.rootDir, (r) => r.endsWith('.d.ts'))) {
            if (this.isTest(rel)) continue
            if (
                rel.startsWith('node_modules/') ||
                rel.includes('/node_modules/')
            )
                continue
            if (rel.startsWith(`${outBase}/`) || rel.includes(`/${outBase}/`))
                continue
            found.push(rel)
        }
        return found
    }

    /**
     * Output directory for one variant + format.
     *
     * With a single variant (the default) the layout stays `dist/<format>` so
     * existing build output is unchanged. With two variants the layout gains a
     * level — `dist/<variant>/<format>` — so each is independently addressable from
     * `exports` conditions.
     */
    formatOutDir(format: Format, variant: Variant): string {
        const parts: string[] = this.config.flat ? [] : [format]
        if (this.config.variants.length > 1) parts.unshift(variant)
        return path.join(this.distDir, ...parts)
    }

    /** The file `bun build` writes for an entry, given `naming.entry`. */
    entryOutPath(entry: string, format: Format, variant: Variant): string {
        const rel = path.relative(this.rootDir, entry).replace(/\.tsx?$/, '')
        const ext = format === 'esm' ? 'mjs' : 'js'
        return path.join(this.formatOutDir(format, variant), `${rel}.${ext}`)
    }

    /** Path relative to the package root, POSIX separators (for tsconfig). */
    relative(abs: string): string {
        return path.relative(this.pkgRoot, abs).split(path.sep).join('/')
    }
}
