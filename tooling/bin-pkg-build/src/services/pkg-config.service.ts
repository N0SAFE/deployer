import { Injectable } from '@nestjs/common'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
    CONFIG_FILE_NAMES,
    LEGACY_CONFIG_KEY,
    pkgBuildConfigSchema,
    type BuildMode,
    type Format,
    type PkgBuildConfig,
    type SourcemapMode,
    type Variant,
} from '../config'
import { die } from '../utils/errors'
import { walkFiles } from '../utils/glob'
import { readJson } from '../utils/json'

/** Every field resolved to a concrete value, except the per-variant knobs. */
export interface ResolvedPkgBuildConfig {
    root: string
    entries: string[] | undefined
    include: string[] | undefined
    formats: Format[] | false
    variants: Variant[]
    outDir: string
    flat: boolean
    target: 'bun' | 'node' | 'browser'
    /** `undefined` means "per-format default" (splitting on for esm only). */
    splitting: boolean | undefined
    /** `undefined` means "per-variant default" (on for production only). */
    minify: boolean | undefined
    /** `undefined` means "per-variant default" (linked in development only). */
    sourcemap: SourcemapMode | undefined
    external: string[]
    copy: { from: string; to: string }[]
    keepEnv: boolean
    types: boolean
}

/**
 * Package configuration and layout.
 *
 * Reads the consuming package's `pkg-build.config.ts` (or one of the other
 * supported basenames) and derives everything the builder needs: the effective
 * config, the entry set, the output layout, and where declarations go.
 *
 * Construction is async (`PkgConfigService.create`) because the config file is
 * an ES module that has to be imported, and an import cannot complete inside a
 * constructor.
 *
 * Defaults (a package with no config file at all):
 *   root:      "src"
 *   entries:   every `src/**\/*.{ts,tsx}` except tests
 *   formats:   esm -> dist/esm/*.mjs, cjs -> dist/cjs/*.js
 *   target:    bun
 *   splitting: on for esm only (bun refuses splitting for cjs)
 *   minify:    production only — development output stays readable
 *   sourcemap: linked in development, none in production
 *   types:     dist/types/**\/*.d.ts — `exports.types` points there, so
 *              consumers type-check declarations instead of package sources
 */
@Injectable()
export class PkgConfigService {
    readonly pkgRoot: string
    readonly manifest: Record<string, unknown>
    config!: ResolvedPkgBuildConfig
    rootDir!: string
    distDir!: string

    /**
     * Declarations live in one layout-independent tree, keyed by source path:
     * `src/a/b.ts` -> `dist/types/a/b.d.ts`. Formats and JSX variants select
     * runtime code only, so they share a single declarations tree.
     */
    typesDir!: string

    /**
     * Generated tsconfig for the declaration pass.
     *
     * Written beside `package.json` (not in a temp directory) so
     * `extends: "./tsconfig.json"` and every `paths` entry it carries resolve
     * exactly as they do for the package's own `type-check`. Removed after the
     * compiler exits.
     */
    typesTsconfig!: string

    /** Absolute path of the config file that was loaded, when one was found. */
    configFile: string | undefined

    private constructor(pkgRoot: string) {
        this.pkgRoot = pkgRoot
        this.manifest = readJson(path.join(pkgRoot, 'package.json'))
    }

    /** Resolve a package's configuration (async: the config file is a module). */
    static async create(
        pkgRoot: string = process.cwd()
    ): Promise<PkgConfigService> {
        const service = new PkgConfigService(pkgRoot)
        const authored = await service.loadAuthoredConfig()
        service.config = service.resolveConfig(authored)
        service.rootDir = path.resolve(pkgRoot, service.config.root)
        service.distDir = path.resolve(pkgRoot, service.config.outDir)
        service.typesDir = path.join(service.distDir, 'types')
        service.typesTsconfig = path.join(
            pkgRoot,
            '.pkg-build-types.tsconfig.json'
        )
        return service
    }

    /**
     * Read the package's build config.
     *
     * The file is validated against the published schema, so a typo fails the
     * build with a pointed message instead of being silently ignored — the
     * failure mode that made the old in-manifest block hard to trust.
     *
     * The legacy `pkgBuild` block in `package.json` is rejected outright rather
     * than honoured: two places to configure one build is how config drifts.
     */
    private async loadAuthoredConfig(): Promise<PkgBuildConfig> {
        if (this.manifest[LEGACY_CONFIG_KEY] !== undefined) {
            die(
                `${String(this.manifest.name ?? this.pkgRoot)}: move the "pkgBuild" block out of package.json into pkg-build.config.ts (typed as PkgBuildConfig from @repo/pkg-build/config).`
            )
        }

        const configFile = this.findConfigFile()
        if (configFile === undefined) return {}
        this.configFile = configFile

        const parsed = pkgBuildConfigSchema.safeParse(
            await this.importConfigFile(configFile)
        )
        if (!parsed.success) {
            const issues = parsed.error.issues
                .map(
                    (issue) =>
                        `  ${issue.path.length > 0 ? issue.path.join('.') : '<root>'}: ${issue.message}`
                )
                .join('\n')
            die(
                `invalid config in ${path.relative(this.pkgRoot, configFile)}\n${issues}`
            )
        }
        return parsed.data
    }

    /** First config file present at the package root, or `undefined`. */
    private findConfigFile(): string | undefined {
        for (const name of CONFIG_FILE_NAMES) {
            const candidate = path.join(this.pkgRoot, name)
            if (fs.existsSync(candidate)) return candidate
        }
        return undefined
    }

    /**
     * Import the config module.
     *
     * A cache-busting query is appended so `--watch` picks up config edits: bun
     * caches ES modules by URL, so without the nonce a changed config would keep
     * returning the first import for the life of the process.
     */
    private async importConfigFile(file: string): Promise<unknown> {
        const url = `${pathToFileURL(file).href}?t=${String(Date.now())}`
        let module: { default?: unknown }
        try {
            module = (await import(url)) as { default?: unknown }
        } catch (error) {
            die(
                `failed to import ${path.relative(this.pkgRoot, file)}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            )
        }
        if (module.default === undefined) {
            die(
                `${path.relative(this.pkgRoot, file)} must have a default export (write \`export default defineConfig({ … })\`)`
            )
        }
        return module.default
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

    /**
     * Minification for one (mode, variant) pair.
     *
     * Only a **production build of the production variant** is minified. That
     * matters because a non-JSX package emits a single `production` variant, so
     * keying off the variant alone would minify every dev-container build and
     * throw away the readable output and sourcemaps that make local debugging
     * possible.
     *
     * An explicit `minify` in the config wins for every pair.
     */
    minifyFor(mode: BuildMode, variant: Variant): boolean {
        return this.config.minify ?? (mode === 'prod' && variant === 'production')
    }

    /**
     * Sourcemap emission for one (mode, variant) pair.
     *
     * Linked everywhere except a production build of the production variant:
     * maps aid local debugging, and are dead weight in what a production
     * consumer loads.
     *
     * An explicit `sourcemap` in the config wins for every pair.
     */
    sourcemapFor(mode: BuildMode, variant: Variant): SourcemapMode {
        return (
            this.config.sourcemap ??
            (mode === 'prod' && variant === 'production' ? 'none' : 'linked')
        )
    }

    /** Resolve the effective config: validate, then apply defaults. */
    private resolveConfig(authored: PkgBuildConfig): ResolvedPkgBuildConfig {
        const root = authored.root ?? 'src'
        const entries = authored.entries
        const include = authored.include

        // Variants are derived from JSX presence unless explicitly overridden.
        // A JSX package needs both runtimes (see `containsJsx`); a non-JSX package
        // has nothing to vary and ships a single production build.
        const variants: Variant[] =
            authored.variants ??
            // `entries` alone does not imply a source root, so scanning for JSX
            // is only meaningful when the root exists.
            (fs.existsSync(path.resolve(this.pkgRoot, root)) &&
            this.containsJsx(path.resolve(this.pkgRoot, root))
                ? ['development', 'production']
                : ['production'])

        return {
            root,
            entries,
            include,
            formats:
                authored.formats === false
                    ? false
                    : (authored.formats ?? ['esm', 'cjs']),
            variants,
            outDir: authored.outDir ?? 'dist',
            flat: authored.flat ?? false,
            target: authored.target ?? 'bun',
            splitting: authored.splitting,
            minify: authored.minify,
            sourcemap: authored.sourcemap,
            external: authored.external ?? [],
            copy: authored.copy ?? [],
            keepEnv: authored.keepEnv !== false,
            types: authored.types !== false,
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
     * With a single variant (the common case) the layout stays `dist/<format>`.
     * With two variants the layout gains a level — `dist/<variant>/<format>` — so
     * each is independently addressable from `exports` conditions.
     */
    formatOutDir(format: Format, variant: Variant): string {
        const parts: string[] = this.config.flat ? [] : [format]
        if (this.config.variants.length > 1) parts.unshift(variant)
        return path.join(this.distDir, ...parts)
    }

    /** The file `bun build` writes for an entry, given the naming template. */
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
