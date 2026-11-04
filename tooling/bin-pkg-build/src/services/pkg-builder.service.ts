import { Injectable } from '@nestjs/common'
import { build } from 'bun'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { c } from '../utils/colors'
import { rewriteDeclarationAliases } from '../utils/declaration-aliases'
import { die } from '../utils/errors'
import { walkFiles } from '../utils/glob'
import { PkgConfigService } from './pkg-config.service'
import type { BuildMode, Format, Variant } from '../config'

export interface PkgBuildRunOptions {
    watch: boolean
    types: boolean
    /** Build target. Defaults to the mode `NODE_ENV` implies. */
    mode?: BuildMode
}
/**
 * The build mode `NODE_ENV` implies.
 *
 * `NODE_ENV=production` marks a build destined for a production consumer (the
 * prod images set it before `turbo run build`); anything else — including the
 * `development` the dev container and `.env.example` set — is a development
 * build, which stays unminified and keeps its sourcemaps.
 *
 * Read with **bracket** access, deliberately. bun statically folds the
 * `process.env.NODE_ENV` dot-form to a string literal at build time (verified:
 * it folds even with `define: {}` and `env: 'disable'`), which would bake THIS
 * package's build-time value into the shipped CLI and make every consumer's mode
 * read the same forever. The bracket form is left as a real runtime lookup.
 */
export function modeFromEnv(): BuildMode {
    return process.env['NODE_ENV'] === 'production' ? 'prod' : 'dev'
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
    async run({ watch, types, mode }: PkgBuildRunOptions): Promise<void> {
        const { manifest, pkgRoot, config } = this.pkg
        // Resolve the mode once, here, and pass it down: the variant children are
        // spawned with `NODE_ENV` overwritten to their variant, so they cannot read
        // the mode off their own environment.
        const buildMode = mode ?? modeFromEnv()
        console.log(
            `${c.cyan('>')} ${c.dim(String(manifest.name ?? pkgRoot))} ${c.dim(
                `[${buildMode}] [${config.variants.join('+')}]${
                    types ? ' [types]' : ''
                }`
            )}`
        )

        // `--types` is the `build:types` task: declarations alone, JS untouched.
        if (types) {
            this.buildTypes()
            if (watch) await this.startWatch(() => this.buildTypes())
            return
        }

        // `buildAll` writes declarations into the same staging tree as the JS, so
        // there is nothing left to build here.
        await this.buildAll(buildMode)
        if (!watch) return

        await this.startWatch(async () => {
            await this.buildAll(buildMode)
        })
    }

    /**
     * Build every format for ONE variant, in this process.
     *
     * Only reached in a variant child process: `bun build` reads `NODE_ENV` at
     * process start, so the variant is already fixed by the time we run.
     */
    async buildVariant(mode: BuildMode, variant: Variant): Promise<void> {
        const entries = this.pkg.listEntries()
        const formats =
            this.pkg.config.formats === false ? [] : this.pkg.config.formats
        await Promise.all(
            formats.map((format) =>
                this.buildFormat(entries, format, mode, variant)
            )
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
        if (!fs.existsSync(rootDir)) die(`Source root not found: ${config.root}`)

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
                // The inherited `outDir` (some packages set `dist`) otherwise
                // routes `tsc --build` bookkeeping — `tsconfig.tsbuildinfo` —
                // into the published tree. Pin it beside the generated config,
                // which is deleted when the compiler exits.
                tsBuildInfoFile: rel(
                    path.join(pkgRoot, `.pkg-build-types.${String(process.pid)}.tsbuildinfo`)
                ),
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
        const tsBuildInfo = path.join(pkgRoot, `.pkg-build-types.${String(process.pid)}.tsbuildinfo`)
        const removeTemp = (): void => {
            fs.rmSync(typesTsconfig, { force: true })
            fs.rmSync(tsBuildInfo, { force: true })
        }
        // `turbo watch` stops a stale task with SIGTERM and `die` ends the process with
        // `process.exit`: neither runs a `finally`, which left 189 per-PID files behind. Each one
        // is a different input to every later hash of the package.
        const onSignal = (signal: NodeJS.Signals): never => {
            removeTemp()
            process.exit(signal === 'SIGINT' ? 130 : 143)
        }
        process.once('SIGTERM', onSignal)
        process.once('SIGINT', onSignal)
        let failed = false
        try {
            const result = Bun.spawnSync([tsc, '-p', typesTsconfig], {
                cwd: pkgRoot,
                stdout: 'inherit',
                stderr: 'inherit',
            })
            failed = result.exitCode !== 0
        } finally {
            removeTemp()
            process.off('SIGTERM', onSignal)
            process.off('SIGINT', onSignal)
        }
        if (failed) die('types build failed')

        for (const ambientRel of ambientDeclarations) {
            const dest = path.join(typesDir, ambientRel)
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            fs.copyFileSync(path.join(rootDir, ambientRel), dest)
        }

        // `tsc` writes import specifiers verbatim, so a `@/x` alias that resolves
        // in source lands in `dist/types` as a specifier no consumer can resolve.
        // Runs after the ambient copy so the authored `.d.ts` files are covered
        // too, and before the summary line so the count it reports is final.
        const aliases = this.pkg.sourceAliases()
        const rewritten = rewriteDeclarationAliases(typesDir, rootDir, aliases)
        if (rewritten.unresolved.length > 0) {
            // Not fatal: an alias naming something outside the emitted tree (a
            // type-only helper, a package subpath) is a real specifier, and
            // failing here would break a build that used to succeed.
            console.warn(
                `${c.yellow('warn')} ${String(
                    this.pkg.manifest.name ?? pkgRoot
                )}: ${String(
                    rewritten.unresolved.length
                )} alias specifier(s) in declarations resolved to no emitted file: ${rewritten.unresolved
                    .slice(0, 5)
                    .join(', ')}${rewritten.unresolved.length > 5 ? ' …' : ''}`
            )
        }

        console.log(
            `${c.green('ok')} types ${c.dim(
                `${entries.length} entries -> ${this.pkg.displayPath(typesDir)}${
                    ambientDeclarations.length > 0
                        ? ` (+${ambientDeclarations.length} source .d.ts)`
                        : ''
                }${
                    rewritten.specifiers > 0
                        ? ` (${String(rewritten.specifiers)} alias specifiers made relative)`
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
     *
     * ── WHY THE BUILD NO LONGER CLEARS `dist` FIRST ─────────────────────────
     * Clearing in place made the output directory EMPTY for the whole build, and
     * `dist` is frequently a SYMLINK into a shared volume that other processes
     * read (`dependency-builder` publishes it; the apps resolve through it).
     * Measured with a poller on the shared volume during one rebuild of
     * `@deployer/ui`: 16_565 consecutive samples where
     * `dist/development/esm/components/shadcn/table.mjs` did not exist. A Next.js
     * dev server compiling in that window fails with
     *
     *   Module not found: Can't resolve '@deployer/ui/components/shadcn/table'
     *
     * — the "errors all of a sudden" that a restart always fixed, because a
     * restart rebuilt into a moment when the tree happened to be complete.
     *
     * The build now goes to a STAGING directory beside the real one and is
     * swapped in at the end. `rename` within one filesystem is atomic, so a
     * reader sees either the previous complete tree or the new complete tree —
     * never a half-written one. Staging lives NEXT TO the target so the rename
     * cannot cross a device boundary (a symlinked `dist` on a volume, a normal
     * `dist` on the image layer).
     */
    async buildAll(mode: BuildMode): Promise<void> {
        const { config, distDir } = this.pkg
        const variants = config.variants

        // Real directory the output lands in, and where it is assembled.
        //
        // `dist` may be a symlink into the publishing volume; `realDist` is where
        // that link points, so staging sits on the SAME filesystem and the final
        // rename stays atomic. `lstat` (not `existsSync`) is required: the latter
        // follows the link, so it cannot tell a link from a directory.
        const distStat = fs.lstatSync(distDir, { throwIfNoEntry: false })
        const realDist =
            distStat?.isSymbolicLink() === true
                ? fs.realpathSync(distDir)
                : distDir

        const staging = `${realDist}.staging-${String(process.pid)}`
        fs.rmSync(staging, { recursive: true, force: true })
        fs.mkdirSync(staging, { recursive: true })
        // A killed build never reaches `publish`, so its staging tree would stay on
        // the volume forever. Everybody else's is safe to remove: the pid in the name
        // is alive only for the process that owns it.
        sweepOrphanedStaging(realDist)
        // `die()` exits without unwinding, so the `finally` below cannot be the only
        // cleanup. Claim the tree now; `releaseStaging` after a successful publish.
        ownStaging(staging)

        try {
            this.pkg.redirectOutput(staging)
            if (variants.length === 1) {
                await this.buildVariant(mode, variants[0]!)
            } else {
                for (const variant of variants) {
                    await this.runChildForVariant(mode, variant, staging)
                }
            }
            // Assets are variant-independent: copied once, at the shared root.
            this.copyAssets(staging)

            // Declarations are written into the SAME staging tree, so the swap
            // installs JS and types together: a consumer must never resolve the new
            // JS against declarations the swap has not installed yet.
            this.buildTypes()

            this.publish(staging, realDist)
            releaseStaging(staging)
        } finally {
            // Restore the real paths before anything else reads them, even when the
            // build threw — a failed build must not leave the process pointing at a
            // half-written staging tree.
            this.pkg.redirectOutput(undefined)
            // Thrown failures unwind through here; `die()` does not, and is covered
            // by the exit hook above. Both paths end with no staging tree left.
            if (OWNED_STAGING.has(staging)) {
                fs.rmSync(staging, { recursive: true, force: true })
                releaseStaging(staging)
            }
        }
    }

    /**
     * Replace `target`'s contents with `staging`, as close to atomically as the
     * filesystem allows.
     *
     * A single `rename` cannot swap one NON-EMPTY directory for another (`ENOTEMPTY`),
     * so the steps are: move the old tree aside, move the new one in, delete the old.
     * The visible window is two renames rather than one build — microseconds instead
     * of seconds — and a crash between them leaves a recoverable state rather than an
     * empty tree.
     *
     * The old tree is moved ASIDE rather than deleted first, so a failure to install
     * the new one can put it back.
     *
     * ── WHY THERE IS A FALLBACK ─────────────────────────────────────────────
     * `rename` on a DIRECTORY fails with `EXDEV: cross-device link not permitted`
     * under overlayfs when the source tree lives in the image's LOWER layer — which
     * is exactly the case in the dependency-builder image, where `dist/` is baked
     * in and then rebuilt at runtime:
     *
     *   Error: EXDEV: cross-device link not permitted,
     *     rename '/app/tooling/bin-runthenkill/dist' -> '.../dist.previous-1261'
     *
     * The same inode device number is reported for both paths (`stat -c %d`), so
     * this is a layer boundary, not a mount: overlayfs cannot rename a directory
     * that has not been copied up. The fallback moves the entries individually,
     * which only ever renames UPPER-layer paths and therefore succeeds.
     *
     * The fallback is not atomic, but it is still bounded per ENTRY instead of per
     * build: only the entry being replaced is briefly absent, never the whole tree.
     * On a real volume (the publishing case this exists for) the atomic path is
     * taken and this branch never runs.
     */
    private publish(staging: string, target: string): void {
        const previous = `${target}.previous-${String(process.pid)}`
        fs.rmSync(previous, { recursive: true, force: true })

        const hadPrevious = fs.existsSync(target)
        if (hadPrevious) {
            try {
                fs.renameSync(target, previous)
            } catch (error) {
                if (!isCrossDevice(error)) throw error
                // The directory cannot be renamed across the overlay boundary; merge
                // entry by entry instead. `staging` is removed either way.
                mergeInto(staging, target)
                return
            }
        }

        try {
            fs.renameSync(staging, target)
        } catch (error) {
            if (!isCrossDevice(error)) {
                // Put the previous tree back: a failed publish must not leave the
                // package without output while its consumers are running.
                if (hadPrevious) fs.renameSync(previous, target)
                fs.rmSync(staging, { recursive: true, force: true })
                throw error
            }
            // `rename` refused the swap; the old tree is already moved aside, so
            // restore it and merge instead of corrupting the target.
            if (hadPrevious) fs.renameSync(previous, target)
            mergeInto(staging, target)
            return
        }

        fs.rmSync(previous, { recursive: true, force: true })
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
        mode: BuildMode,
        variant: Variant
    ): Promise<void> {
        const { config, rootDir, pkgRoot, manifest } = this.pkg
        const outDir = this.pkg.formatOutDir(format, variant)
        const ext = format === 'esm' ? 'mjs' : 'js'
        const minify = this.pkg.minifyFor(mode, variant)
        const sourcemap = this.pkg.sourcemapFor(mode, variant)

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
                treeShaking: true,
                minify,
                sourcemap,
                // Chunks land in a `chunks/` subdirectory so the entry tree stays a
                // readable mirror of `src/` instead of being polluted with
                // `<name>-<hash>` files. Entry names keep the source basename so a
                // stack frame or a stray import maps straight back to a file.
                naming: {
                    entry: `[dir]/[name].${ext}`,
                    chunk: `chunks/[name]-[hash].${ext}`,
                },
                // Workspace + external deps stay external: the consuming app
                // resolves them, and bundling would duplicate singletons.
                packages: 'external',
                // A package that imports itself by name (`@deployer/ui/lib/utils`)
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
                // The config's own escape hatch, applied per pass. A plugin that
                // rewrites module resolution (see `plugins` in `config.ts`) must
                // run for BOTH the server and the client pass, which is why it
                // travels here rather than being attached once.
                ...(config.plugins.length > 0
                    ? { plugins: config.plugins }
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
                `${entries.length} entries -> ${this.pkg.displayPath(outDir)}${
                    minify ? ' [minified]' : ''
                }${sourcemap === 'none' ? ' [no map]' : ''}`
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
            // Whitespace is optional so a minified body (no newline after `;`) is
            // still matched.
            const withoutStray = body
                .replace(/^"use (client|server)";?\s*/, '')
                .replace(/["']use (client|server)["'];?/g, '')
            if (withoutStray !== body) stripped += 1

            // An entry that declares a directive must lead with it.
            const directive = entryOut.get(outFile)
            const finalBody =
                directive !== undefined
                    ? `"${directive}";\n${withoutStray}`
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

    /** Every emitted JS file (entries and chunks) for this format + variant. */
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
     * and `apps/web` imports `envSchema` from `@deployer/env`. With the exports empty,
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

    private runChildForVariant(
        mode: BuildMode,
        variant: Variant,
        staging: string
    ): Promise<void> {
        const childEntry = this.variantChildEntry()
        return new Promise((resolve, reject) => {
            const child = Bun.spawn(
                [
                    process.execPath,
                    childEntry,
                    `--variant=${variant}`,
                    `--mode=${mode}`,
                    // The child re-loads the config and derives its own output
                    // paths, so the staging root has to cross the process
                    // boundary: without it a variant build would write into the
                    // LIVE tree the swap is meant to protect.
                    `--out-root=${staging}`,
                ],
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

/**
 * Staging trees this process currently owns.
 *
 * Removed on process exit, because `die()` is how a build failure is reported —
 * and `die()` calls `process.exit(1)`, which does NOT throw and does NOT run a
 * `finally`. Measured: a `--types` failure (`TS2688: Cannot find type definition
 * file for 'node'`) exited 1, left `dist` untouched, and kept a complete
 * `vol.staging-1797304` tree holding `cjs/`, `esm/` and `types/`.
 *
 * `exit` handlers run synchronously, which is why the removal is `rmSync`.
 */
const OWNED_STAGING = new Set<string>()
let exitHookInstalled = false

/** Claim a staging tree so an abnormal exit still removes it. */
function ownStaging(dir: string): void {
    OWNED_STAGING.add(dir)
    if (exitHookInstalled) return
    exitHookInstalled = true
    process.on('exit', () => {
        for (const dir of OWNED_STAGING) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
        OWNED_STAGING.clear()
    })
}

/** Forget a staging tree: it was published, or already removed. */
function releaseStaging(dir: string): void {
    OWNED_STAGING.delete(dir)
}

/**
 * Whether a filesystem error is overlayfs refusing to rename across a layer
 * boundary.
 *
 * The device numbers of both paths are identical (`stat -c %d`), so the usual
 * "different mount" reading of `EXDEV` is wrong here: the old tree has simply not
 * been copied up from the image's lower layer.
 */
function isCrossDevice(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'EXDEV'
    )
}

/**
 * Install `staging`'s entries into `target` one at a time, for filesystems that
 * refuse a directory rename.
 *
 * `staging` is always removed, including on failure: an abandoned staging tree is
 * hundreds of files that the next run has to walk, and it is the residue a killed
 * build leaves on a publishing volume.
 */
function mergeInto(staging: string, target: string): void {
    fs.mkdirSync(target, { recursive: true })
    try {
        for (const entry of fs.readdirSync(staging)) {
            const from = path.join(staging, entry)
            const to = path.join(target, entry)
            fs.rmSync(to, { recursive: true, force: true })
            try {
                fs.renameSync(from, to)
            } catch (error) {
                if (!isCrossDevice(error)) throw error
                // A directory whose entries are themselves lower-layer files cannot
                // be renamed either; copy it across.
                fs.cpSync(from, to, { recursive: true })
                fs.rmSync(from, { recursive: true, force: true })
            }
        }
    } finally {
        fs.rmSync(staging, { recursive: true, force: true })
    }
}

/**
 * Remove staging trees left behind by processes that no longer exist.
 *
 * A build that is killed (container stop, CI timeout, a crash between the build
 * and the publish) never reaches `publish`, so its `dist.staging-<pid>` stays on
 * the publishing volume. Left alone they accumulate one full tree per kill — the
 * measured residue was 7 directories spanning `ui`, `runtime-contracts`,
 * `mesh-service`, `bin-runthenkill` and others.
 *
 * Liveness is the pid in the name: `process.kill(pid, 0)` succeeds for a live
 * process and throws `ESRCH` for a dead one. That is what makes this safe to run
 * while other packages are building — those pids belong to running children and
 * their trees are kept.
 *
 * ── PID REUSE ───────────────────────────────────────────────────────────────
 * A pid is only unique among LIVE processes, so a recycled pid can point at an
 * unrelated process and the sweep would keep a dead tree. That is the safe
 * direction (a leftover, not a deletion of something in use), and the next run
 * clears it once that pid is free again. Deleting on an ambiguity would be the
 * unsafe direction, and is deliberately not done.
 */
export function sweepOrphanedStaging(realDist: string): void {
    const parent = path.dirname(realDist)
    const prefix = `${path.basename(realDist)}.staging-`
    let entries: string[]
    try {
        entries = fs.readdirSync(parent)
    } catch {
        return
    }
    for (const entry of entries) {
        if (!entry.startsWith(prefix)) continue
        const pid = Number(entry.slice(prefix.length))
        // `Number('')` is 0 and `Number('12abc')` is NaN; both mean the name is
        // not one this code wrote, so leave it alone rather than guess.
        if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue
        // `kill(pid, 0)` is a liveness probe: no signal is sent. `EPERM` means the
        // process EXISTS but belongs to another user — treat it as live, because
        // deleting a tree another build is writing would corrupt its output.
        try {
            process.kill(pid, 0)
            continue
        } catch (error) {
            const code =
                typeof error === 'object' && error !== null && 'code' in error
                    ? (error as { code?: unknown }).code
                    : undefined
            if (code !== 'ESRCH') continue
        }
        fs.rmSync(path.join(parent, entry), { recursive: true, force: true })
    }
}
