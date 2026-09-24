#!/usr/bin/env bun
/**
 * Normalize every package's `exports` to the `@repo/ui` shape, idempotently.
 *
 * Target shape:
 *   ".":    { types: ["./src/index.ts", "./src/index.tsx"],
 *             import: "./dist/esm/index.mjs", require: "./dist/cjs/index.js" }
 *   "./*":  { types: ["./src/*.ts", "./src/*.tsx"],
 *             import: "./dist/esm/*.mjs", require: "./dist/cjs/*.js" }
 *
 * `types` points at **source**, so a consumer type-checks without any package
 * build. That is only sound because package-internal imports use the package's
 * own name (`@repo/<pkg>/x`) rather than `@/x`: `paths` aliases are resolved
 * from the consumer's tsconfig, while `exports` subpaths are per-package.
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
    if (typeof value === 'string') return /\.tsx?$/.test(value) ? value : null;
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

for (const rel of new Glob('packages/**/package.json').scanSync({ cwd: root })) {
    if (rel.includes('node_modules')) continue;
    const dir = path.dirname(rel);
    // Tooling configs are loaded by eslint/prettier/vitest directly.
    if (dir.startsWith('packages/configs/')) continue;
    // Packages whose sources live at the package root define their own shape
    // (`@repo/api-contracts` has a root `index.ts` plus a `src/`).
    if (ROOT_ENTRY_PACKAGES.has(dir)) continue;
    // Packages whose sources live at the package root define their own shape.
    if (!fs.existsSync(path.join(root, dir, 'src'))) continue;

    const manifestPath = path.join(root, rel);
    const manifest = JSON.parse(
        stripJsonComments(fs.readFileSync(manifestPath, 'utf8')),
    ) as Record<string, unknown>;

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
                    ? { types: branchSrc, ...branchDist }
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
            ? { types: srcPath, ...dist }
            : srcPath;
    }

    const before = JSON.stringify(manifest);
    manifest.types = './src/index.ts';
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
        '.': { types: ['./src/index.ts', './src/index.tsx'], ...rootConditions },
        './*': {
            types: ['./src/*.ts', './src/*.tsx'],
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
