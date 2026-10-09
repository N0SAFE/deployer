#!/usr/bin/env bun
/**
 * Normalize every package's `exports` to the `@repo/ui` shape, idempotently.
 *
 * Target shape:
 *   ".":    { types: "./dist/types/index.d.ts",
 *             import: "./dist/esm/index.mjs", require: "./dist/cjs/index.js" }
 *   "./*":  { types: "./dist/types/*.d.ts",
 *             import: "./dist/esm/*.mjs", require: "./dist/cjs/*.js" }
 *
 * `types` points at the declarations `pkg-build` emits to `dist/types/`, so a
 * consumer type-checks declarations instead of re-compiling package sources.
 * That is what keeps a type-check from dragging every package's implementation
 * (and its inferred types) into the consumer's program.
 *
 * The script also maintains the manifest scripts that drive the declarations
 * task: every package whose `build` runs `pkg-build` gets
 * `"build:types": "<build> --types"`.
 *
 * Named subpaths are preserved but flattened to `{ types, import, require }`.
 * An earlier pass double-applied and produced `types: { types: ... }`; this
 * repairs that too, which is why the source path is recovered structurally
 * rather than assumed to be a string.
 */

import { Glob } from 'bun';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const DRY = process.argv.includes('--dry');

/**
 * Packages whose public entry sits at the package root rather than `src/`.
 * Their exports are authored deliberately and must not be rewritten.
 */
const ROOT_ENTRY_PACKAGES = new Set(['packages/contracts/api']);

/**
 * The builder itself. Its entry is a CLI (`bin`), not a library export, so the
 * `exports` normalization below does not apply. Its manifests are authored.
 */
const TOOL_PACKAGES = new Set(['tooling/bin-pkg-build']);

/**
 * The CLI's bin name, as declared in `@repo/pkg-build`'s `bin` map.
 *
 * Invocations are rewritten to call it by name so the caller never encodes the
 * builder's internal `dist/` layout, and the path cannot rot when either package
 * moves.
 */
const PKG_BUILD_BIN = 'pkg-build';

/**
 * Rewrite any invocation of the pkg-build CLI to its bin name.
 *
 * Handles both the historical relative paths into the builder's own output
 * (`../../tooling/bin-pkg-build/dist/cjs/main.js`) and an invocation that
 * already uses the bin name — so a re-run is idempotent and still counts as
 * "this package builds with pkg-build".
 *
 * Returns the rewritten script, or `null` when the script does not invoke the
 * builder's CLI.
 *
 * `src/main.ts` is deliberately NOT matched: several packages have their own
 * `src/main.ts`, and the builder itself must keep running from source (it cannot
 * invoke its own bin before that bin has been built).
 */
function rewritePkgBuildInvocation(script: string): string | null {
    if (/bin-pkg-build\//.test(script)) {
        return script.replace(
            /bun\s+(--bun\s+)?\S*bin-pkg-build\/\S*/g,
            (_match, bunFlag: string | undefined) =>
                `bun ${bunFlag ?? ''}${PKG_BUILD_BIN}`.replace(/\s+/g, ' ').trim(),
        );
    }
    if (/bun\s+(?:--bun\s+)?pkg-build(?:\s|$)/.test(script)) return script;
    return null;
}

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
            if (char === '\n') { inLine = false; out += char; }
            continue;
        }
        if (inBlock) {
            if (char === '*' && next === '/') { inBlock = false; i += 1; }
            continue;
        }
        if (inString) {
            out += char;
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') { inString = true; out += char; continue; }
        if (char === '/' && next === '/') { inLine = true; i += 1; continue; }
        if (char === '/' && next === '*') { inBlock = true; i += 1; continue; }
        out += char;
    }
    return out.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Ensure the package's `tsconfig.json` includes its authored `pkg-build.config.ts`.
 *
 * Without this the `defineConfig()` typing is decorative: `type-check` never
 * reads a file outside the program's `include`, so a misspelled key passes CI
 * and only fails when the builder runs.
 *
 * Several tsconfigs carry comments, so this edits the file as text rather than
 * round-tripping through `JSON.parse`. `include` is the last key in every one of
 * these files, so prepending an entry preserves the rest verbatim.
 *
 * A package-level `rootDir` pointing at `src` is removed in the same pass: it
 * exists only to reject files outside `src`, and the builder's declaration pass
 * pins its own `rootDir` (with `files` + `include: []`) so the package's copy is
 * already dead. Leaving it in place makes `tsc` fail with TS6059 the moment the
 * root-level config file joins the program.
 */
function ensureTsconfigIncludesConfig(pkgDir: string): void {
    const tsconfigPath = path.join(root, pkgDir, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) return;
    let source = fs.readFileSync(tsconfigPath, 'utf8');

    const rootDirPattern = /"rootDir"\s*:\s*"([^"]*)"\s*,?\s*/;
    const rootDir = rootDirPattern.exec(source);
    if (rootDir !== null && rootDir[1] !== '.' && rootDir[1] !== './') {
        source = source.replace(rootDirPattern, '').replace(/,\s*([}\]])/g, '$1');
        report.push(`  · ${pkgDir} (dropped dead rootDir)`);
        changed += 1;
    }

    if (!source.includes('"pkg-build.config.ts"')) {
        const include = /"include"\s*:\s*\[\s*/.exec(source);
        if (include !== null) {
            const insertAt = include.index + include[0].length;
            source = `${source.slice(0, insertAt)}"pkg-build.config.ts", ${source.slice(
                insertAt,
            )}`;
            report.push(`  · ${pkgDir} (tsconfig include)`);
            changed += 1;
        }
    }

    fs.writeFileSync(tsconfigPath, source);
}

/**
 * How a package lays its runtime output out on disk.
 *
 * - `flat`  : `dist/<format>/…` — single-variant packages.
 * - `variant`: `dist/<variant>/<format>/…` — JSX packages, which must ship both
 *   a `development` and a `production` build so the consumer's bundler can pick
 *   the matching React JSX runtime through export conditions.
 *
 * Detected from the filesystem so the exports always match what was built.
 */
type Layout =
    | { kind: 'flat' }
    | { kind: 'variant'; variants: string[] };

function detectLayout(pkgDir: string): Layout {
    const distDir = path.join(root, pkgDir, 'dist');
    if (!fs.existsSync(distDir)) return { kind: 'flat' };

    const variants = fs
        .readdirSync(distDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && ['development', 'production'].includes(e.name))
        .map((e) => e.name)
        .sort();

    return variants.length > 1 ? { kind: 'variant', variants } : { kind: 'flat' };
}

/**
 * The runtime targets for a source path, as an `exports` condition block.
 *
 * Single-variant packages get plain `import`/`require`. Variant packages nest
 * those under `development`/`production`, with `default` pointing at production
 * so a consumer that passes neither condition still gets the safe build.
 */
function runtimeConditions(srcPath: string, layout: Layout): Record<string, unknown> | null {
    const m = /^\.\/src\/(.+)\.(ts|tsx)$/.exec(srcPath);
    if (!m) return null;
    const stem = m[1]!;

    if (layout.kind === 'flat') {
        return {
            import: `./dist/esm/${stem}.mjs`,
            require: `./dist/cjs/${stem}.js`,
        };
    }

    const byVariant: Record<string, unknown> = {};
    for (const variant of layout.variants) {
        byVariant[variant] = {
            import: `./dist/${variant}/esm/${stem}.mjs`,
            require: `./dist/${variant}/cjs/${stem}.js`,
        };
    }
    return {
        ...byVariant,
        default: byVariant['production'] ?? byVariant[layout.variants[0]!],
    };
}

/** `./src/a/b.ts` -> `./dist/types/a/b.d.ts`. */
function typesPath(srcPath: string): string | null {
    const m = /^\.\/src\/(.+)\.(ts|tsx)$/.exec(srcPath);
    if (!m) return null;
    return `./dist/types/${m[1]}.d.ts`;
}

/** `./src/a/b.ts` -> the two runtime targets (flat layout). */
function distPaths(srcPath: string): { import: string; require: string } | null {
    const m = /^\.\/src\/(.+)\.(ts|tsx)$/.exec(srcPath);
    if (!m) return null;
    return {
        import: `./dist/esm/${m[1]}.mjs`,
        require: `./dist/cjs/${m[1]}.js`,
    };
}

/**
 * Recover the source path from any shape a previous pass may have produced:
 * a bare string, a flat object, or a nested `types` object.
 */
function sourcePathOf(value: unknown): string | null {
    if (typeof value === 'string') {
        // Emitted declarations (`.d.ts`) match `\.tsx?$` too; they are not
        // source paths and must not be fed back through `runtimeConditions`.
        if (/\.d\.[mc]?ts$/.test(value)) return null;
        return /\.tsx?$/.test(value) ? value : null;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = sourcePathOf(entry);
            if (found) return found;
        }
        return null;
    }
    if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        for (const key of ['types', 'import', 'require', 'default']) {
            const found = sourcePathOf(obj[key]);
            if (found) return found;
        }
    }
    return null;
}

let changed = 0;
const report: string[] = [];

for (const rel of [
    ...new Glob('packages/**/package.json').scanSync({ cwd: root }),
    ...new Glob('tooling/**/package.json').scanSync({ cwd: root }),
]) {
    if (rel.includes('node_modules')) continue;
    const dir = path.dirname(rel);
    const manifestPath = path.join(root, rel);
    const manifest = JSON.parse(
        stripJsonComments(fs.readFileSync(manifestPath, 'utf8')),
    ) as Record<string, unknown>;

    const before = JSON.stringify(manifest);

    // Every package that uses pkg-build gets an explicit workspace dependency on
    // the builder, and its `pkg-build.config.ts` joined to the TS program. The
    // dependency is what lets turbo order `@repo/pkg-build#build` before any
    // consumer task — consumers execute the built CLI, because bun resolves
    // tsconfig from the CWD and running the CLI source under a consumer's
    // tsconfig silently drops its decorators.
    //
    // The CLI is invoked by its **bin name** (`pkg-build`), resolved through
    // this package's own `node_modules/.bin`. Relative paths into another
    // package's `dist/` break the moment either package moves, and encode an
    // internal layout the caller has no business knowing.
    //
    // Every such path is rewritten, in every script, unconditionally. Deriving
    // `build:types` is the narrower operation: it is only correct when `build`
    // itself runs the CLI. `@repo/config-eslint` is the hybrid case — custom
    // bundler for JS, pkg-build for declarations — so its `build:types` is
    // authored around its own `build`, not regenerated from it.
    const scripts = (manifest.scripts ?? {}) as Record<string, string>;
    for (const [name, script] of Object.entries(scripts)) {
        if (typeof script !== 'string') continue;
        const rewritten = rewritePkgBuildInvocation(script);
        if (rewritten !== null) scripts[name] = rewritten;
    }
    const usesPkgBuild = Object.values(scripts).some(
        (script) => typeof script === 'string' && rewritePkgBuildInvocation(script) !== null,
    );
    if (usesPkgBuild) {
        // Derived task, regenerated from `build` — but only when `build` is the
        // CLI itself. A hybrid package authors its own `build:types`.
        if (
            typeof scripts.build === 'string' &&
            rewritePkgBuildInvocation(scripts.build) !== null
        ) {
            scripts['build:types'] = `${scripts.build} --types`;
        }
        manifest.scripts = scripts;
        const devDependencies = (manifest.devDependencies ?? {}) as Record<string, string>;
        if (devDependencies['@repo/pkg-build'] === undefined) {
            devDependencies['@repo/pkg-build'] = '*';
            manifest.devDependencies = devDependencies;
        }
        // `pkg-build.config.ts` must be part of the package's TS program, or the
        // `defineConfig()` typing is decorative: `type-check` never reads the
        // file, so a misspelled key passes CI and only fails in the builder.
        if (!DRY) ensureTsconfigIncludesConfig(dir);
    }

    // Tooling configs are loaded by eslint/prettier/vitest directly; their
    // exports are authored, not generated. Root-entry packages and the builder
    // itself likewise. Their manifests are still written when the declarations
    // script above was added.
    const authoredExports =
        dir.startsWith('packages/configs/') ||
        // Every `tooling/**` package authors its own `exports` (prettier exposes
        // `./base`/`./tailwind`, eslint points some entries at `src/`, the CLIs
        // have no library surface at all). Only their *scripts* are normalized.
        dir.startsWith('tooling/') ||
        ROOT_ENTRY_PACKAGES.has(dir) ||
        TOOL_PACKAGES.has(dir) ||
        !fs.existsSync(path.join(root, dir, 'src'));
    if (authoredExports) {
        if (JSON.stringify(manifest) !== before) {
            if (!DRY) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
            changed += 1;
            report.push(`  · ${String(manifest.name ?? dir)} (scripts)`);
        }
        continue;
    }

    const layout = detectLayout(dir);
    const existing = (manifest.exports ?? {}) as Record<string, unknown>;
    const named: Record<string, unknown> = {};
    const assets: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(existing)) {
        if (key === '.' || key === './*' || key === './src/*') continue;

        // A conditional block (`react-server` / `default`) selects a different
        // file per environment. It must be preserved key-for-key, so each branch
        // is converted independently rather than collapsed to one target.
        if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            Object.keys(value as Record<string, unknown>).every(
                (k) => !['types', 'import', 'require'].includes(k),
            )
        ) {
            const conditions: Record<string, unknown> = {};
            for (const [condition, target] of Object.entries(value as Record<string, unknown>)) {
                const branchSrc = sourcePathOf(target);
                if (branchSrc === null) {
                    conditions[condition] = target;
                    continue;
                }
                const branchDist = runtimeConditions(branchSrc, layout);
                conditions[condition] = branchDist
                    ? { types: typesPath(branchSrc) ?? branchSrc, ...branchDist }
                    : branchSrc;
            }
            named[key] = conditions;
            continue;
        }

        const srcPath = sourcePathOf(value);
        if (srcPath === null) {
            // Non-TS asset (css/json): keep verbatim.
            if (typeof value === 'string') assets[key] = value;
            else named[key] = value;
            continue;
        }
        const dist = runtimeConditions(srcPath, layout);
        named[key] = dist
            ? { types: typesPath(srcPath) ?? srcPath, ...dist }
            : srcPath;
    }

    manifest.types = './dist/types/index.d.ts';
    if (layout.kind === 'flat') {
        manifest.main = './dist/cjs/index.js';
        manifest.module = './dist/esm/index.mjs';
    } else {
        const primary = layout.variants.includes('production')
            ? 'production'
            : layout.variants[0]!;
        manifest.main = `./dist/${primary}/cjs/index.js`;
        manifest.module = `./dist/${primary}/esm/index.mjs`;
    }

    const rootConditions = runtimeConditions('./src/index.ts', layout) ?? {};
    const globConditions = runtimeConditions('./src/placeholder.ts', layout) ?? {};

    // `./*` targets mirror `internal/*`, so rebuild the glob by swapping the
    // placeholder stem for the wildcard.
    const withWildcard = (value: unknown): unknown => {
        if (typeof value === 'string') {
            return value.replace('placeholder', '*');
        }
        if (Array.isArray(value)) return value.map(withWildcard);
        if (typeof value === 'object' && value !== null) {
            return Object.fromEntries(
                Object.entries(value as Record<string, unknown>).map(([k, v]) => [
                    k,
                    withWildcard(v),
                ]),
            );
        }
        return value;
    };

    manifest.exports = {
        '.': { types: './dist/types/index.d.ts', ...rootConditions },
        './*': {
            types: './dist/types/*.d.ts',
            ...(withWildcard(globConditions) as Record<string, unknown>),
        },
        ...named,
        ...assets,
    };

    if (JSON.stringify(manifest) !== before) {
        if (!DRY) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
        changed += 1;
        report.push(`  · ${String(manifest.name ?? dir)}`);
    }
}

for (const line of report) console.log(line);
console.log(`${changed} manifest(s) normalized${DRY ? ' (dry run)' : ''}`);
