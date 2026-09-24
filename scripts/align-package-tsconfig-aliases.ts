#!/usr/bin/env bun
/**
 * Point each package's tsconfig alias at its own name, and convert leftover `@/`.
 *
 * Packages now import their own files through the package name
 * (`@repo/auth/permissions`), because a `paths` alias is resolved from the
 * *consumer's* tsconfig — so `@/x` inside a package cannot work once its source
 * is part of a consumer's program. The tsconfig must therefore map
 * `@repo/<pkg>/*` → `./src/*` rather than the obsolete `@/*`.
 *
 * The `@/*` mapping is dropped only when the package no longer uses it; app
 * packages (`apps/*`) legitimately keep `@/*` for their own code and are not
 * touched here.
 */

import { Glob } from 'bun';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const DRY = process.argv.includes('--dry');

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

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveToFile(srcAbs: string, fromDirRel: string, spec: string): string | null {
    const matchExt = (base: string): string | null => {
        for (const ext of EXTENSIONS) {
            const candidate = path.join(srcAbs, `${base}${ext}`);
            if (fs.existsSync(candidate)) {
                const stat = fs.statSync(candidate);
                if (stat.isFile()) return `${base}${ext}`.replace(/\.(ts|tsx)$/, '');
            }
        }
        return null;
    };

    const joined = path.normalize(path.join(fromDirRel, spec)).replace(/\\/g, '/');
    if (!joined.startsWith('..')) {
        const found = matchExt(joined);
        if (found !== null) return found;
    }
    // Over-counted `../` runs: retry each shorter suffix from the src root.
    const parts = spec.split('/');
    for (let i = 1; i < parts.length; i += 1) {
        const tail = parts.slice(i).join('/');
        if (!tail) continue;
        const found = matchExt(tail);
        if (found !== null) return found;
    }
    return null;
}

/** package dir -> { name, srcAbs }. */
const packages = new Map<string, { name: string; srcAbs: string }>();
for (const rel of new Glob('packages/**/package.json').scanSync({ cwd: root })) {
    if (rel.includes('node_modules')) continue;
    const dir = path.dirname(rel);
    if (dir.startsWith('packages/configs/')) continue;
    const srcAbs = path.join(root, dir, 'src');
    if (!fs.existsSync(srcAbs)) continue;
    const manifest = JSON.parse(
        stripJsonComments(fs.readFileSync(path.join(root, rel), 'utf8')),
    ) as { name?: string };
    if (manifest.name) packages.set(dir, { name: manifest.name, srcAbs });
}

// ── 1. leftover `@/` → `@repo/<pkg>/…` ─────────────────────────────────────
let convertedFiles = 0;
let convertedSpecs = 0;

for (const [dir, { name, srcAbs }] of packages) {
    for (const rel of new Glob('src/**/*.{ts,tsx}').scanSync({ cwd: path.join(root, dir) })) {
        const abs = path.join(root, dir, rel);
        const before = fs.readFileSync(abs, 'utf8');
        if (!before.includes("'@/") && !before.includes('"@/')) continue;

        const after = before.replace(
            /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])@\/([^'"]+)\2/g,
            (match, prefix: string, quote: string, sub: string) => {
                const target = resolveToFile(srcAbs, '.', `./${sub}`);
                if (target === null) return match;
                convertedSpecs += 1;
                return `${prefix}${quote}${name}/${target}${quote}`;
            },
        );

        if (after !== before) {
            if (!DRY) fs.writeFileSync(abs, after);
            convertedFiles += 1;
        }
    }
}

// ── 2. tsconfig: alias the package name, drop stale `@/*` ──────────────────
let tsconfigsChanged = 0;

for (const [dir, { name }] of packages) {
    const tsconfigPath = path.join(root, dir, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) continue;

    const raw = fs.readFileSync(tsconfigPath, 'utf8');
    const parsed = JSON.parse(stripJsonComments(raw)) as {
        compilerOptions?: { paths?: Record<string, string[]> };
        [key: string]: unknown;
    };
    const compilerOptions = parsed.compilerOptions ?? {};
    const paths = { ...(compilerOptions.paths ?? {}) };

    const selfKey = `${name}/*`;
    const before = JSON.stringify(paths);

    // The package's own name wins for its own files.
    paths[selfKey] = ['./src/*'];

    // `@/*` was the old convention. Drop it: the package name replaces it, and
    // leaving it would shadow nothing but confuse readers.
    if (Object.prototype.hasOwnProperty.call(paths, '@/*')) delete paths['@/*'];

    if (JSON.stringify(paths) === before) continue;

    // Put the self mapping first so it is resolved before any broader pattern.
    const ordered: Record<string, string[]> = { [selfKey]: paths[selfKey]! };
    for (const [key, value] of Object.entries(paths)) {
        if (key !== selfKey) ordered[key] = value;
    }

    compilerOptions.paths = ordered;
    parsed.compilerOptions = compilerOptions;

    if (!DRY) fs.writeFileSync(tsconfigPath, `${JSON.stringify(parsed, null, 2)}\n`);
    tsconfigsChanged += 1;
}

console.log(
    `${convertedFiles} file(s), ${convertedSpecs} leftover @/ specifier(s) → @repo/<pkg>/…\n` +
        `${tsconfigsChanged} tsconfig(s) → "@repo/<pkg>/*": ["./src/*"]${DRY ? ' (dry run)' : ''}`,
);
