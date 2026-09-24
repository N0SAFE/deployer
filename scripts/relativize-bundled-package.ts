#!/usr/bin/env bun
/**
 * Give the bundled CLI its relative imports back.
 *
 * `@repo/cli-declarative-routing` is a self-contained CLI: one entry
 * (`src/index.ts`) that bun bundles into `dist/index.js`. Converting its
 * internal imports to the package's own name made every internal module an
 * *external* dependency, which a single-entry CJS bundle cannot satisfy at
 * runtime (`Cannot find package '@repo/cli-declarative-routing/config'`).
 *
 * For a bundled app/CLI, relative imports are the correct form: nothing
 * consumes these modules individually through `exports`.
 */

import { Glob } from 'bun';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const DRY = process.argv.includes('--dry');

/** Packages that are bundled apps/CLIs rather than subpath-consumed libraries. */
const BUNDLED_PACKAGES = ['packages/bin/declarative-routing'];

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

let filesChanged = 0;
let specsChanged = 0;

for (const pkgDir of BUNDLED_PACKAGES) {
    const manifestPath = path.join(root, pkgDir, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { name?: string };
    const pkgName = manifest.name;
    if (!pkgName) continue;

    const srcAbs = path.join(root, pkgDir, 'src');

    for (const rel of new Glob('src/**/*.{ts,tsx}').scanSync({ cwd: path.join(root, pkgDir) })) {
        const abs = path.join(root, pkgDir, rel);
        const before = fs.readFileSync(abs, 'utf8');
        const fromDirRel = path.dirname(rel.slice('src/'.length));

        const after = before.replace(
            new RegExp(`(['"])${pkgName.replace(/[/@]/g, '\\$&')}/([^'"]+)\\1`, 'g'),
            (match, quote: string, target: string) => {
                // Find the real file, then make a relative specifier to it.
                for (const ext of EXTENSIONS) {
                    const candidate = path.join(srcAbs, `${target}${ext}`);
                    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                        const isIndex = /\/index\.tsx?$/.test(candidate);
                        const base = isIndex ? path.dirname(candidate) : candidate.replace(/\.tsx?$/, '');
                        let relative = path
                            .relative(path.join(srcAbs, fromDirRel), base)
                            .replace(/\\/g, '/');
                        if (!relative.startsWith('.')) relative = `./${relative}`;
                        specsChanged += 1;
                        return `${quote}${relative}${quote}`;
                    }
                }
                return match;
            },
        );

        if (after !== before) {
            if (!DRY) fs.writeFileSync(abs, after);
            filesChanged += 1;
        }
    }
}

console.log(`${filesChanged} file(s), ${specsChanged} specifier(s) → relative${DRY ? ' (dry run)' : ''}`);
