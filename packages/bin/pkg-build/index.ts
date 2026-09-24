#!/usr/bin/env -S bun
/**
 * Shared, configurable workspace package builder.
 *
 * Every package builds through this one pipeline. Behaviour is driven by a
 * `"pkgBuild"` block in the package's own `package.json`, so a package that
 * needs something unusual declares it locally instead of forking a script.
 *
 * Defaults (no `pkgBuild` block needed):
 *   root:      "src"
 *   entries:   every `src/**\/*.{ts,tsx}` except tests
 *   formats:   esm -> dist/esm/*.mjs, cjs -> dist/cjs/*.js
 *   target:    bun
 *   splitting: on for esm only (bun refuses splitting for cjs)
 *   types:     not emitted — `exports.types` points at the original `src/*.ts`
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
 *   keepEnv     boolean   Keep `process.env.X` as a runtime lookup (default true).
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
 *
 * Usage (from a package directory):
 *   bun --bun ../../bin/pkg-build/index.ts            # one-shot
 *   bun --bun ../../bin/pkg-build/index.ts --watch     # rebuild on change
 */

import { build, Glob } from 'bun';
import * as fs from 'node:fs';
import * as path from 'node:path';

const c = {
    dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
    green: (s: string) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
    red: (s: string) => `\x1b[31m${s}\x1b[0m`,
    cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

type Format = 'esm' | 'cjs';
type Variant = 'development' | 'production';

interface PkgBuildConfig {
    root: string;
    entries?: string[];
    include?: string[];
    formats: Format[] | false;
    variants: Variant[];
    outDir: string;
    flat: boolean;
    target: 'bun' | 'node' | 'browser';
    splitting?: boolean;
    minify: boolean;
    sourcemap: 'linked' | 'external' | 'inline' | 'none';
    external: string[];
    copy: { from: string; to: string }[];
    keepEnv: boolean;
}

const pkgRoot = process.cwd();
const args = process.argv.slice(2);
const WATCH = args.includes('--watch');

/**
 * Internal flag: this process builds exactly one variant.
 *
 * `bun build` reads `NODE_ENV` once at process start, so a variant can only be
 * selected by a fresh process. The parent spawns one child per variant.
 */
const VARIANT_ARG_PREFIX = '--variant=';

function die(message: string): never {
    console.error(`${c.red('✖')} ${message}`);
    process.exit(1);
}

/**
 * Remove comments and trailing commas from a tsconfig/JSONC file.
 *
 * Must be string-aware: a naive regex sees `/*` inside `"../*"` as the start of
 * a block comment and eats the rest of the file.
 */
function stripJsonComments(input: string): string {
    let out = '';
    let inString = false;
    let inLine = false;
    let inBlock = false;
    let escaped = false;

    for (let i = 0; i < input.length; i += 1) {
        const char = input[i]!;
        const next = input[i + 1];

        if (inLine) {
            if (char === '\n') {
                inLine = false;
                out += char;
            }
            continue;
        }
        if (inBlock) {
            if (char === '*' && next === '/') {
                inBlock = false;
                i += 1;
            }
            continue;
        }
        if (inString) {
            out += char;
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            out += char;
            continue;
        }
        if (char === '/' && next === '/') {
            inLine = true;
            i += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            inBlock = true;
            i += 1;
            continue;
        }
        out += char;
    }
    return out.replace(/,\s*([}\]])/g, '$1');
}

function readJson(file: string): Record<string, unknown> {
    return JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8'))) as Record<
        string,
        unknown
    >;
}

const manifest = readJson(path.join(pkgRoot, 'package.json'));
const raw = (manifest.pkgBuild ?? {}) as Record<string, unknown>;

/** Test files are never part of a published surface. */
const isTest = (rel: string): boolean =>
    /\.(test|spec)\.tsx?$/.test(rel) || /(^|\/)(__tests__|__mocks__|tests)\//.test(rel);

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
function containsJsx(sourceDir: string): boolean {
    if (!fs.existsSync(sourceDir)) return false;
    for (const rel of new Glob('**/*.tsx').scanSync({ cwd: sourceDir })) {
        if (!isTest(rel)) return true;
    }
    return false;
}

/** Resolve the effective config: defaults, then the package's overrides. */
function resolveConfig(): PkgBuildConfig {
    const formatsRaw = raw.formats;
    let formats: Format[] | false;
    if (formatsRaw === false) {
        formats = false;
    } else if (Array.isArray(formatsRaw)) {
        formats = formatsRaw.filter((f): f is Format => f === 'esm' || f === 'cjs');
    } else if (formatsRaw && typeof formatsRaw === 'object') {
        const obj = formatsRaw as Record<string, unknown>;
        formats = (['esm', 'cjs'] as const).filter((f) => obj[f] !== false);
    } else {
        formats = ['esm', 'cjs'];
    }

    const rootDirResolved = path.resolve(pkgRoot, typeof raw.root === 'string' ? raw.root : 'src');

    // Variants are derived from JSX presence unless explicitly overridden.
    // A JSX package needs both runtimes (see `containsJsx`); a non-JSX package
    // has nothing to vary and ships a single production build.
    const variantsRaw = raw.variants;
    const explicitVariants = Array.isArray(variantsRaw)
        ? variantsRaw.filter((v): v is Variant => v === 'development' || v === 'production')
        : [];
    const variants: Variant[] =
        explicitVariants.length > 0
            ? explicitVariants
            : containsJsx(rootDirResolved)
              ? ['development', 'production']
              : ['production'];

    return {
        root: typeof raw.root === 'string' ? raw.root : 'src',
        entries: Array.isArray(raw.entries) ? (raw.entries as string[]) : undefined,
        include: Array.isArray(raw.include) ? (raw.include as string[]) : undefined,
        formats,
        variants: variants.length > 0 ? variants : ['production'],
        outDir: typeof raw.outDir === 'string' ? raw.outDir : 'dist',
        flat: raw.flat === true,
        target: (raw.target as PkgBuildConfig['target']) ?? 'bun',
        splitting: typeof raw.splitting === 'boolean' ? raw.splitting : undefined,
        minify: raw.minify === true,
        sourcemap: (raw.sourcemap as PkgBuildConfig['sourcemap']) ?? 'linked',
        external: Array.isArray(raw.external) ? (raw.external as string[]) : [],
        copy: Array.isArray(raw.copy) ? (raw.copy as PkgBuildConfig['copy']) : [],
        keepEnv: raw.keepEnv !== false,
    };
}

const config = resolveConfig();
const rootDir = path.resolve(pkgRoot, config.root);
const distDir = path.resolve(pkgRoot, config.outDir);

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
function listEntries(): string[] {
    if (!fs.existsSync(rootDir)) die(`Source root not found: ${config.root}`);

    const entries = new Set<string>();

    for (const rel of config.entries ?? []) {
        const abs = path.resolve(rootDir, rel);
        if (!fs.existsSync(abs)) die(`Entry not found: ${path.relative(pkgRoot, abs)}`);
        entries.add(abs);
    }

    // The glob runs for `include` subdirs, or over the whole root when neither
    // `entries` nor `include` is given. Explicit `entries` alone must not drag
    // in unrelated root files (configs, scripts).
    const scanDirs =
        config.include ?? (config.entries === undefined ? [''] : []);

    for (const sub of scanDirs) {
        const base = path.join(rootDir, sub);
        if (!fs.existsSync(base)) continue;
        for (const rel of new Glob('**/*.{ts,tsx}').scanSync({ cwd: base })) {
            if (rel.endsWith('.d.ts') || isTest(rel)) continue;
            entries.add(path.join(base, rel));
        }
    }

    if (entries.size === 0) {
        die(`No entry points found under ${path.relative(pkgRoot, rootDir)}`);
    }
    return [...entries];
}

/**
 * Output directory for one variant + format.
 *
 * With a single variant (the default) the layout stays `dist/<format>` so
 * existing build output is unchanged. With two variants the layout gains a
 * level — `dist/<variant>/<format>` — so each is independently addressable from
 * `exports` conditions.
 */
function formatOutDir(format: Format, variant: Variant): string {
    const parts = config.flat ? [] : [format];
    if (config.variants.length > 1) parts.unshift(variant);
    return path.join(distDir, ...parts);
}

/** Directives that must remain the first statement of the emitted module. */
const DIRECTIVES = ['use client', 'use server'] as const;
type Directive = (typeof DIRECTIVES)[number];

/**
 * Read the directive a source file opens with, if any.
 *
 * `bun build` hoists imports **above** the directive, so it survives into the
 * output at the wrong position. Turbopack/RSC then reject the module with
 * `The "use client" directive must be placed before other expressions`.
 */
function readDirective(absPath: string): Directive | null {
    const head = fs.readFileSync(absPath, 'utf8').replace(/^\uFEFF/, '').trimStart();
    for (const directive of DIRECTIVES) {
        if (head.startsWith(`"${directive}"`) || head.startsWith(`'${directive}'`)) {
            return directive;
        }
    }
    return null;
}

/** The file `bun build` writes for an entry, given `naming.entry`. */
function entryOutPath(entry: string, format: Format, variant: Variant): string {
    const rel = path.relative(rootDir, entry).replace(/\.tsx?$/, '');
    const ext = format === 'esm' ? 'mjs' : 'js';
    return path.join(formatOutDir(format, variant), `${rel}.${ext}`);
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
function applyDirectives(entries: string[], format: Format, variant: Variant): void {
    const applied = new Map<Directive, number>();
    let stripped = 0;

    const entryOut = new Map<string, Directive>();
    for (const entry of entries) {
        const directive = readDirective(entry);
        if (directive !== null) entryOut.set(entryOutPath(entry, format, variant), directive);
    }

    for (const outFile of listEmittedFiles(format, variant)) {
        const body = fs.readFileSync(outFile, 'utf8');

        // Drop any directive that is no longer the first statement. The bundler
        // emits `"use client";` on its own line, possibly after hoisted imports.
        const withoutLeading = body.replace(/^"use (client|server)";?\r?\n/, '');
        const withoutStray = withoutLeading.replace(
            /^[ \t]*["']use (client|server)["'];?[ \t]*\r?\n/gm,
            '',
        );
        if (withoutStray !== body) stripped += 1;

        // An entry that declares a directive must lead with it.
        const directive = entryOut.get(outFile);
        const finalBody =
            directive !== undefined ? `"${directive}"\n${withoutStray}` : withoutStray;

        if (finalBody !== body) fs.writeFileSync(outFile, finalBody);
        if (directive !== undefined) {
            applied.set(directive, (applied.get(directive) ?? 0) + 1);
        }
    }

    for (const [directive, count] of applied) {
        console.log(
            `${c.green('✔')} ${format.padEnd(4)} ${c.dim(
                `${count} × "${directive}" on entries${stripped > 0 ? `, ${stripped} stripped` : ''}`,
            )}`,
        );
    }
}

/** Every file `bun build` wrote for this format + variant. */
function listEmittedFiles(format: Format, variant: Variant): string[] {
    const outDir = formatOutDir(format, variant);
    if (!fs.existsSync(outDir)) return [];
    return new Glob('**/*.{mjs,js}').scanSync({ cwd: outDir }).map((rel) => path.join(outDir, rel));
}

/**
 * Build one format for the variant this process was launched with.
 *
 * This process only ever builds a single variant: `bun build` reads `NODE_ENV`
 * at process start, so the variant is fixed before we run.
 */
async function buildFormat(entries: string[], format: Format, variant: Variant): Promise<void> {
    const outDir = formatOutDir(format, variant);
    const ext = format === 'esm' ? 'mjs' : 'js';

    // Client and server entries are built in SEPARATE passes so their chunks are
    // never shared. A shared chunk would let a server component pull client code
    // (and its boundary) into the same module.
    const clientish: string[] = [];
    const rest: string[] = [];
    for (const entry of entries) {
        (readDirective(entry) === null ? rest : clientish).push(entry);
    }

    const runBuild = async (targets: string[]): Promise<void> => {
        if (targets.length === 0) return;
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
            naming: { entry: `[dir]/[name].${ext}`, chunk: `[name]-[hash].${ext}` },
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
                    ? [`${String(manifest.name)}`, `${String(manifest.name)}/*`]
                    : []),
                ...config.external,
            ],
            // Keep `process.env.X` a runtime lookup. bun otherwise inlines
            // NODE_ENV at build time, silently changing behaviour for code that
            // reads it per request (or a test that sets it in beforeEach).
            // The JSX runtime is chosen by the variant's process env, not here.
            ...(config.keepEnv ? { define: {}, env: 'disable' as const } : {}),
        });
        if (!result.success) {
            for (const log of result.logs) console.error(log);
            die(`${format} build failed`);
        }
    };

    await runBuild(rest);
    await runBuild(clientish);
    applyDirectives(clientish, format, variant);

    console.log(
        `${c.green('✔')} ${format.padEnd(4)} ${c.dim(
            `${entries.length} entries → ${path.relative(pkgRoot, outDir)}`,
        )}`,
    );
}

/**
 * Copy declared assets into the output root.
 *
 * Assets are variant-independent (CSS, images), so they are copied once at the
 * shared root rather than duplicated per variant.
 */
function copyAssets(targetRoot: string): void {
    for (const { from, to } of config.copy) {
        const src = path.resolve(pkgRoot, from);
        if (!fs.existsSync(src)) continue;
        // `to` is declared relative to `outDir`; re-root it under targetRoot.
        const dest = path.join(targetRoot, path.relative(config.outDir, to));
        copyTree(src, dest);
        console.log(`${c.green('✔')} copy ${c.dim(`${from} → ${path.relative(pkgRoot, dest)}`)}`);
    }
}

function copyTree(from: string, to: string): void {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        if (entry.isDirectory()) copyTree(src, dest);
        else fs.copyFileSync(src, dest);
    }
}

/**
 * Build every format for ONE variant, in this process.
 *
 * Only reached in a child process: `bun build` reads `NODE_ENV` at process
 * start, so the variant is already fixed by the time we run.
 */
async function buildVariant(variant: Variant): Promise<void> {
    const entries = listEntries();
    const formats = config.formats === false ? [] : config.formats;
    await Promise.all(formats.map((format) => buildFormat(entries, format, variant)));
}

/**
 * Drive the build.
 *
 * Two variants require two child processes, because `bun build` samples
 * `NODE_ENV` at process start and no build option overrides the JSX runtime it
 * selects. A single variant runs in-process.
 */
async function buildAll(): Promise<void> {
    const variants = config.variants;

    fs.rmSync(distDir, { recursive: true, force: true });

    if (variants.length === 1) {
        await buildVariant(variants[0]!);
    } else {
        for (const variant of variants) {
            await runChildForVariant(variant);
        }
    }

    // Assets are variant-independent: copied once, at the shared root.
    copyAssets(distDir);
}

/** Spawn this script again with `NODE_ENV` set for one variant. */
function runChildForVariant(variant: Variant): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = Bun.spawn(
            [process.execPath, import.meta.path, `${VARIANT_ARG_PREFIX}${variant}`],
            {
                cwd: pkgRoot,
                env: { ...process.env, NODE_ENV: variant },
                stdout: 'inherit',
                stderr: 'inherit',
            },
        );
        child.exited
            .then((code) => {
                if (code === 0) resolve();
                else reject(new Error(`${variant} build exited with code ${code}`));
            })
            .catch(reject);
    });
}

async function main(): Promise<void> {
    // Child process for one variant. `NODE_ENV` was set by the parent, which is
    // what decides the React JSX runtime `bun build` emits.
    const variantArg = args.find((a) => a.startsWith(VARIANT_ARG_PREFIX));
    if (variantArg !== undefined) {
        await buildVariant(variantArg.slice(VARIANT_ARG_PREFIX.length) as Variant);
        return;
    }

    console.log(
        `${c.cyan('▶')} ${c.dim(String(manifest.name ?? pkgRoot))} ${c.dim(
            `[${config.variants.join('+')}]`,
        )}`,
    );

    if (!WATCH) {
        await buildAll();
        return;
    }

    await buildAll();
    console.log(`${c.yellow('👀')} watching ${config.root}/`);

    let chokidar: typeof import('chokidar') | null = null;
    try {
        chokidar = await import('chokidar');
    } catch {
        die('watch mode requires chokidar (add it to devDependencies)');
    }

    let running = false;
    let queued = false;
    const rebuild = () => {
        if (running) {
            queued = true;
            return;
        }
        running = true;
        void buildAll()
            .catch((error: unknown) => console.error(error))
            .finally(() => {
                running = false;
                if (queued) {
                    queued = false;
                    rebuild();
                }
            });
    };

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
            if (typeof changedPath === 'string' && !/\.(ts|tsx|css|json)$/.test(changedPath)) {
                return;
            }
            rebuild();
        });
}

await main();
