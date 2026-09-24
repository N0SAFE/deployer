#!/usr/bin/env bun
/**
 * Compare a package's scripts against git HEAD to find accidentally dropped ones.
 *
 * Usage: bun --bun scripts/audit-dropped-scripts.ts <pkg-dir-relative-to-repo>
 */

import { $ } from 'bun';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(import.meta.dir, '..');

const targets = process.argv.slice(2);
if (targets.length === 0) {
    console.error('usage: audit-dropped-scripts.ts <pkg-dir> [pkg-dir...]');
    process.exit(1);
}

for (const rel of targets) {
    const manifestPath = path.join(root, rel, 'package.json');
    const head = JSON.parse(
        await $`git show HEAD:${rel}/package.json`.text(),
    ) as { scripts?: Record<string, string> };
    const now = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        scripts?: Record<string, string>;
    };

    const headScripts = head.scripts ?? {};
    const nowScripts = now.scripts ?? {};
    const dropped = Object.keys(headScripts).filter((k) => !(k in nowScripts));
    const added = Object.keys(nowScripts).filter((k) => !(k in headScripts));
    const changed = Object.keys(headScripts).filter(
        (k) => k in nowScripts && headScripts[k] !== nowScripts[k],
    );

    console.log(`\n### ${rel}`);
    if (dropped.length === 0) console.log('  dropped: (none)');
    else {
        console.log('  DROPPED:');
        for (const k of dropped) console.log(`    ${k} = ${headScripts[k]}`);
    }
    if (added.length > 0) {
        console.log('  added:');
        for (const k of added) console.log(`    ${k} = ${nowScripts[k]}`);
    }
    if (changed.length > 0) {
        console.log('  changed:');
        for (const k of changed) {
            console.log(`    ${k}:`);
            console.log(`      HEAD: ${headScripts[k]}`);
            console.log(`      now : ${nowScripts[k]}`);
        }
    }
}
