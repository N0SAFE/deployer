import { Injectable } from '@nestjs/common'
import { build } from 'bun'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { c } from '../utils/colors'
import { die } from '../utils/errors'
import { walkFiles } from '../utils/glob'
import {
    PkgConfigService,
    type Format,
    type Variant,
} from './pkg-config.service'

export interface PkgBuildRunOptions {
    watch: boolean
    types: boolean
}

/** Directives that must remain the first statement of the emitted module. */
const DIRECTIVES = ['use client', 'use server'] as const
type Directive = (typeof DIRECTIVES)[number]

/**
 * The build pipeline.
 *
 * Order of concerns per invocation:
 *   1. JS bundles (`bun build`, one pass per format/variant)
 *   2. declarations (`tsc`, one pass for all formats/variants)
 *
 * A full build runs both; `--types` runs declarations alone and never touches
 * the JS output, which is what makes the two halves independently watchable.
 *
 * Variants and the JSX runtime
 * ----------------------------
 * `bun build` chooses the React JSX runtime from `NODE_ENV` **at process
 * start** — setting `process.env.NODE_ENV` inside the process has no effect, and
 * neither `--production` nor the tsconfig `jsx` setting changes it. React's
 * production `jsx-dev-runtime` exports `jsxDEV = void 0`, so a dev-runtime build
 * throws the moment it is prerendered by a production consumer.
 *
 * Each variant therefore runs in its own child process with `NODE_ENV` set, so
 * `development` emits `jsxDEV` calls (React's dev validation and warnings) and
 * `production` emits `jsx`/`jsxs` (the runtime that exists in both React builds).
 */
@Injectable()
export class PkgBuilderService {
    constructor(private readonly pkg: PkgConfigService) {}

    /** Entry point for the CLI: one-shot or watch, JS + types or types only. */
    async run({ watch, types }: PkgBuildRunOptions): Promise<void> {
        const { manifest, pkgRoot, config } = this.pkg
        console.log(
            `${c.cyan('>')} ${c.dim(String(manifest.name ?? pkgRoot))} ${c.dim(
                `[${config.variants.join('+')}]${types ? ' [types]' : ''}`
            )}`
        )

        // `--types` is the `build:types` task: declarations alone, JS untouched.
        if (types) {
            this.buildTypes()
            if (watch) await this.startWatch(() => this.buildTypes())
            return
        }

        await this.buildAll()
        this.buildTypes()
        if (!watch) return

        await this.startWatch(async () => {
            await this.buildAll()
            this.buildTypes()
        })
    }

    /**
     * Build every format for ONE variant, in this process.
     *
     * Only reached in a variant child process: `bun build` reads `NODE_ENV` at
     * process start, so the variant is already fixed by the time we run.
     */
    async buildVariant(variant: Variant): Promise<void> {
        const entries = this.pkg.listEntries()
        const formats =
            this.pkg.config.formats === false ? [] : this.pkg.config.formats
        await Promise.all(
            formats.map((format) => this.buildFormat(entries, format, variant))
        )
    }

    /**
     * Emit `dist/types/**` with tsc.
     *
     * `bun build` does not produce declarations, so this pass runs the compiler
     * against a generated config: the package's own tsconfig (paths, decorators,
     * JSX) with output redirected to the declarations tree. The JS output is left
     * alone, which is what makes `build:types` safe to run on its own and under
     * `turbo watch`.
     */
    buildTypes(): void {
        const { config, rootDir, typesDir, typesTsconfig, pkgRoot } = this.pkg
        if (!config.types) return
        if (!fs.existsSync(rootDir))
            die(`Source root not found: ${config.root}`)

        const entries = this.pkg.listEntries()
        // Source `.d.ts` files are inputs, not outputs: they must be part of the
        // program (so `declare module` blocks apply) but tsc never emits them, so
        // they are copied to the output tree afterwards.
        const ambientDeclarations = this.pkg.listAmbientDeclarations()

        // Clear only the declarations subtree. `dist` itself may be a symlink into
        // the publishing volume (dependency-builder); removing the link would
        // strand the JS output, so only the tree below it is removed.
        fs.rmSync(typesDir, { recursive: true, force: true })

        const rel = (abs: string): string => this.pkg.relative(abs)
        const baseTsconfig = path.join(pkgRoot, 'tsconfig.json')
        const base: {
            extends?: string
            compilerOptions?: Record<string, unknown>
        } = fs.existsSync(baseTsconfig)
            ? { extends: './tsconfig.json' }
            : {
                  compilerOptions: {
                      target: 'ES2022',
                      module: 'ESNext',
                      moduleResolution: 'bundler',
                      strict: true,
                      skipLibCheck: true,
                      esModuleInterop: true,
                      resolveJsonModule: true,
                      allowJs: true,
                      types: ['node'],
                      ...(this.pkg.containsJsx(rootDir)
                          ? { jsx: 'react-jsx' }
                          : {}),
                  },
              }
        const tsconfig = {
            ...base,
            compilerOptions: {
                ...(base.compilerOptions ?? {}),
                // The package's own config is `noEmit`; declarations need emit.
                noEmit: false,
                declaration: true,
                declarationMap: true,
                emitDeclarationOnly: true,
                composite: false,
                incremental: false,
                outDir: rel(typesDir),
                rootDir: rel(rootDir),
            },
            // `files` is the same entry set as the JS build plus authored `.d.ts`
            // inputs. `include: []` makes sure the base config's include globs
            // (which drag tests in) do not union with it.
            files: [
                ...entries,
                ...ambientDeclarations.map((a) => path.join(rootDir, a)),
            ].map(rel),
            include: [],
        }
        fs.writeFileSync(
            typesTsconfig,
            `${JSON.stringify(tsconfig, null, 4)}\n`
        )

        const tsc = this.pkg.resolveTsc()
        try {
            const result = Bun.spawnSync([tsc, '-p', typesTsconfig], {
                cwd: pkgRoot,
                stdout: 'inherit',
                stderr: 'inherit',
            })
            if (result.exitCode !== 0) die('types build failed')
        } finally {
            fs.rmSync(typesTsconfig, { force: true })
        }

        for (const ambientRel of ambientDeclarations) {
            const dest = path.join(typesDir, ambientRel)
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            fs.copyFileSync(path.join(rootDir, ambientRel), dest)
        }

        console.log(
            `${c.green('ok')} types ${c.dim(
                `${entries.length} entries -> ${path.relative(pkgRoot, typesDir)}${
                    ambientDeclarations.length > 0
                        ? ` (+${ambientDeclarations.length} source .d.ts)`
                        : ''
                }`
            )}`
        )
    }

    /**
     * Drive the JS build.
     *
     * Two variants require two child processes, because `bun build` samples
     * `NODE_ENV` at process start and no build option overrides the JSX runtime it
     * selects. A single variant runs in-process.
     */
    async buildAll(): Promise<void> {
        const { config, distDir } = this.pkg
        const variants = config.variants

        // A `dist` that is a symlink points at a publishing directory owned by the
        // dependency-builder. Removing it would dereference the link and send the
        // build output into the package directory instead, so the artifacts would
        // never reach the volume the applications read from. Clear the CONTENTS and
        // leave the link in place.
        const distIsLink =
            fs
                .lstatSync(distDir, { throwIfNoEntry: false })
                ?.isSymbolicLink() === true
        if (distIsLink) {
            for (const entry of fs.readdirSync(distDir)) {
                fs.rmSync(path.join(distDir, entry), {
                    recursive: true,
                    force: true,
                })
            }
        } else {
            fs.rmSync(distDir, { recursive: true, force: true })
        }

        if (variants.length === 1) {
            await this.buildVariant(variants[0]!)
        } else {
            for (const variant of variants) {
                await this.runChildForVariant(variant)
            }
        }

        // Assets are variant-independent: copied once, at the shared root.
        this.copyAssets(distDir)
    }

    /**
     * Build one format for the variant this process was launched with.
     *
     * This process only ever builds a single variant: `bun build` reads `NODE_ENV`
     * at process start, so the variant is fixed before we run.
     */
    private async buildFormat(
        entries: string[],
        format: Format,
        variant: Variant
    ): Promise<void> {
        const { config, rootDir, pkgRoot, manifest } = this.pkg
        const outDir = this.pkg.formatOutDir(format, variant)
        const ext = format === 'esm' ? 'mjs' : 'js'

        // Client and server entries are built in SEPARATE passes so their chunks are
        // never shared. A shared chunk would let a server component pull client code
        // (and its boundary) into the same module.
        const clientish: string[] = []
        const rest: string[] = []
        for (const entry of entries) {
            ;(this.readDirective(entry) === null ? rest : clientish).push(entry)
        }

        const runBuild = async (targets: string[]): Promise<void> => {
            if (targets.length === 0) return
            const result = await build({
                entrypoints: targets,
                outdir: outDir,
                root: rootDir,
                format,
                target: config.target,
                // bun refuses code splitting for cjs ("Code splitting currently only
                // supported when format set to esm").
                splitting: config.splitting ?? format === 'esm',
                minify: config.minify,
                sourcemap: config.sourcemap,
                naming: {
                    entry: `[dir]/[name].${ext}`,
                    chunk: `[name]-[hash].${ext}`,
                },
                // Workspace + external deps stay external: the consuming app
                // resolves them, and bundling would duplicate singletons.
                packages: 'external',
                // A package that imports itself by name (`@repo/ui/lib/utils`)
                // must keep those imports external too. Left to resolve, the
                // bundler inlines the target module into the importer — carrying
                // that module's `"use client"` directive along, mid-file, where it
                // is both meaningless and invalid for Turbopack. Keeping each module
                // its own file preserves the client/server boundary the directives
                // describe.
                external: [
                    ...(manifest.name
                        ? [
                              `${String(manifest.name)}`,
                              `${String(manifest.name)}/*`,
                          ]
                        : []),
                    ...config.external,
                ],
                // Keep `process.env.X` a runtime lookup. bun otherwise inlines
                // NODE_ENV at build time, silently changing behaviour for code that
                // reads it per request (or a test that sets it in beforeEach).
                // The JSX runtime is chosen by the variant's process env, not here.
                ...(config.keepEnv
                    ? { define: {}, env: 'disable' as const }
                    : {}),
            })
            if (!result.success) {
                for (const log of result.logs) console.error(log)
                die(`${format} build failed`)
            }
        }

        await runBuild(rest)
        await runBuild(clientish)
        this.applyDirectives(clientish, format, variant)
        this.writeFormatMarker(format, variant)

        console.log(
            `${c.green('ok')} ${format.padEnd(4)} ${c.dim(
                `${entries.length} entries -> ${path.relative(pkgRoot, outDir)}`
            )}`
        )
    }

    /**
     * Read the directive a source file opens with, if any.
     *
     * `bun build` hoists imports **above** the directive, so it survives into the
     * output at the wrong position. Turbopack/RSC then reject the module with
     * `The "use client" directive must be placed before other expressions`.
     */
    private readDirective(absPath: string): Directive | null {
        const head = fs
            .readFileSync(absPath, 'utf8')
            .replace(/^\uFEFF/, '')
            .trimStart()
        for (const directive of DIRECTIVES) {
            if (
                head.startsWith(`"${directive}"`) ||
                head.startsWith(`'${directive}'`)
            ) {
                return directive
            }
        }
        return null
    }

    /**
     * Prepend each entry's directive to its emitted file, and strip directives that
     * the bundler transplanted into the body.
     *
     * `bun build` hoists imports above a source's directive, so the directive lands
     * mid-file. Turbopack/RSC then reject the module with
     * `The "use client" directive must be placed before other expressions`.
     *
     * Only an **entry** may carry a directive. A module that merely *imports* a
     * client module gets that module inlined together with its directive, which is
     * meaningless in the importer and invalid mid-file. Those stray copies are
     * removed: the client boundary is declared once, by the entry that actually
     * opens with the directive.
     */
    private applyDirectives(
        entries: string[],
        format: Format,
        variant: Variant
    ): void {
        const applied = new Map<Directive, number>()
        let stripped = 0

        const entryOut = new Map<string, Directive>()
        for (const entry of entries) {
            const directive = this.readDirective(entry)
            if (directive !== null) {
                entryOut.set(
                    this.pkg.entryOutPath(entry, format, variant),
                    directive
                )
            }
        }

        for (const outFile of this.listEmittedFiles(format, variant)) {
            const body = fs.readFileSync(outFile, 'utf8')

            // Drop any directive that is no longer the first statement. The bundler
            // emits `"use client";` on its own line, possibly after hoisted imports.
            const withoutLeading = body.replace(
                /^"use (client|server)";?\r?\n/,
                ''
            )
            const withoutStray = withoutLeading.replace(
                /^[ \t]*["']use (client|server)["'];?[ \t]*\r?\n/gm,
                ''
            )
            if (withoutStray !== body) stripped += 1

            // An entry that declares a directive must lead with it.
            const directive = entryOut.get(outFile)
            const finalBody =
                directive !== undefined
                    ? `"${directive}"\n${withoutStray}`
                    : withoutStray

            if (finalBody !== body) fs.writeFileSync(outFile, finalBody)
            if (directive !== undefined) {
                applied.set(directive, (applied.get(directive) ?? 0) + 1)
            }
        }

        for (const [directive, count] of applied) {
            console.log(
                `${c.green('ok')} ${format.padEnd(4)} ${c.dim(
                    `${count} × "${directive}" on entries${stripped > 0 ? `, ${stripped} stripped` : ''}`
                )}`
            )
        }
    }

    /** Every file `bun build` wrote for this format + variant. */
    private listEmittedFiles(format: Format, variant: Variant): string[] {
        const outDir = this.pkg.formatOutDir(format, variant)
        if (!fs.existsSync(outDir)) return []
        return walkFiles(outDir, (rel) => /\.(mjs|js)$/.test(rel)).map((rel) =>
            path.join(outDir, rel)
        )
    }

    /**
     * Declare the module system of an emitted format.
     *
     * Packages that declare `"type": "module"` make Node interpret **every** `.js`
     * file in the package as ESM. The CJS output is written as `dist/cjs/*.js`, so
     * without a closer marker Node parses it as ESM: `module.exports` never applies
     * and `require('<pkg>')` yields an empty object.
     *
     * That is not hypothetical — `next.config.ts` is loaded through CJS `require`,
     * and `apps/web` imports `envSchema` from `@repo/env`. With the exports empty,
     * `envSchema` was `undefined`, so `next.config.ts` threw
     * `TypeError: Cannot read properties of undefined (reading 'shape')`. The web
     * build then failed *only under turbo* (which runs the real build), and a
     * failing task is never cached — which is what made `turbo` look like it was
     * "not caching api and web".
     *
     * A `{"type":"commonjs"}` file inside the CJS output directory scopes the
     * declaration to that subtree, so `.js` there is CJS while the package (and the
     * `.mjs` ESM output) stay ESM.
     */
    private writeFormatMarker(format: Format, variant: Variant): void {
        // Only meaningful for CJS: the ESM output uses `.mjs`, which is always ESM.
        if (format !== 'cjs') return
        const outDir = this.pkg.formatOutDir(format, variant)
        if (!fs.existsSync(outDir)) return

        const marker = path.join(outDir, 'package.json')
        const body = `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`
        if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === body)
            return
        fs.writeFileSync(marker, body)
    }

    /**
     * Copy declared assets into the output root.
     *
     * Assets are variant-independent (CSS, images), so they are copied once at the
     * shared root rather than duplicated per variant.
     */
    private copyAssets(targetRoot: string): void {
        const { pkgRoot, config } = this.pkg
        for (const { from, to } of config.copy) {
            const src = path.resolve(pkgRoot, from)
            if (!fs.existsSync(src)) continue
            // `to` is declared relative to `outDir`; re-root it under targetRoot.
            const dest = path.join(targetRoot, path.relative(config.outDir, to))
            this.copyTree(src, dest)
            console.log(
                `${c.green('ok')} copy ${c.dim(`${from} -> ${path.relative(pkgRoot, dest)}`)}`
            )
        }
    }

    private copyTree(from: string, to: string): void {
        fs.mkdirSync(to, { recursive: true })
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
            const src = path.join(from, entry.name)
            const dest = path.join(to, entry.name)
            if (entry.isDirectory()) this.copyTree(src, dest)
            else fs.copyFileSync(src, dest)
        }
    }

    /**
     * Spawn the variant child with `NODE_ENV` set for one variant.
     *
     * The child is a dedicated entry (`src/variant-child.ts`), not the CLI again:
     * it constructs the services directly, so it skips the Nest/commander
     * bootstrap. The extension comes from THIS module; the directory is checked
     * in both layouts because bundling flattens the tree:
     *
     * - source: this file is `src/services/…`, the child is `src/variant-child.ts`
     * - built: this file is inlined into `dist/<format>/main.{mjs,js}`, and the
     *   child is a sibling entry `dist/<format>/variant-child.{mjs,js}`
     */
    private variantChildEntry(): string {
        const name = `variant-child${path.extname(import.meta.path)}`
        const sameDir = path.join(import.meta.dir, name)
        return fs.existsSync(sameDir)
            ? sameDir
            : path.join(import.meta.dir, '..', name)
    }

    private runChildForVariant(variant: Variant): Promise<void> {
        const childEntry = this.variantChildEntry()
        return new Promise((resolve, reject) => {
            const child = Bun.spawn(
                [process.execPath, childEntry, `--variant=${variant}`],
                {
                    cwd: this.pkg.pkgRoot,
                    env: { ...process.env, NODE_ENV: variant },
                    stdout: 'inherit',
                    stderr: 'inherit',
                }
            )
            child.exited
                .then((code) => {
                    if (code === 0) resolve()
                    else
                        reject(
                            new Error(
                                `${variant} build exited with code ${code}`
                            )
                        )
                })
                .catch(reject)
        })
    }

    /**
     * Rebuild on change until the process is killed.
     *
     * The canonical types watcher is `turbo watch build:types`; this exists so a
     * standalone `--watch` (JS + types) also stays current.
     */
    private async startWatch(
        rebuild: () => void | Promise<void>
    ): Promise<void> {
        const { config, rootDir } = this.pkg
        console.log(`${c.yellow('~')} watching ${config.root}/`)

        let chokidar: typeof import('chokidar') | null = null
        try {
            chokidar = await import('chokidar')
        } catch {
            die('watch mode requires chokidar (add it to devDependencies)')
        }

        let running = false
        let queued = false
        const trigger = () => {
            if (running) {
                queued = true
                return
            }
            running = true
            void Promise.resolve(rebuild())
                .catch((error: unknown) => console.error(error))
                .finally(() => {
                    running = false
                    if (queued) {
                        queued = false
                        trigger()
                    }
                })
        }

        // chokidar 4+ removed glob support, so `watch('src/**/*')` matches nothing
        // and watch mode silently never rebuilds. Watch the directory and filter in
        // the handler instead.
        chokidar
            .watch(rootDir, {
                ignoreInitial: true,
                ignored: /(^|[/\\])\.|node_modules/,
                awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 40 },
            })
            .on('all', (_event, changedPath) => {
                if (
                    typeof changedPath === 'string' &&
                    !/\.(ts|tsx|css|json)$/.test(changedPath)
                ) {
                    return
                }
                trigger()
            })
    }
}
