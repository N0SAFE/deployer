/**
 * Make a package resolvable by its OWN name from its own directory.
 *
 * THE PROBLEM
 * -----------
 * `pkg-builder.service.ts` keeps a package's own name `external` on purpose:
 *
 *     external: [manifest.name, manifest.name + '/*']
 *
 * with a documented reason — a package that self-imports by name must keep each module
 * in its own file, because inlining would drag a `"use client"` directive into the
 * middle of the importer, where Turbopack rejects it. 16 packages self-import by name
 * in source (`@deployer/ui` alone has 53 `"use client"` files), so the rule is correct
 * and stays.
 *
 * The consequence is that EMITTED output contains specifiers like
 *
 *     require('@deployer/contracts-common/environment.schema')
 *
 * inside `contracts-common`'s OWN `dist/cjs/index.js`. That must resolve through
 * `node_modules`. From a consumer it does (verified: `apps/api/dist` resolves
 * `@deployer/contracts-common`), but from the package's own dist it does not — because
 * `bun install` links only DECLARED dependencies and never a package's own name:
 *
 *     packages/contracts-common/node_modules/@deployer/
 *       config-typescript  pkg-build  type-guards        <- no contracts-common
 *
 * Measured after a clean install:
 *
 *     node require('./packages/contracts/common/dist/cjs/index.js')
 *       Error: Cannot find module '@deployer/contracts-common/environment.schema'
 *
 * `db:generate` fails the same way: drizzle-kit is a NODE program that loads
 * `packages/nest/schema/src/global/index.ts`, which pulls those barrels in.
 *
 * THE FIX
 * -------
 * Create the self-link `bun install` does not: `node_modules/<own-name> -> ../..`.
 * This is the standard npm/pnpm self-reference, it is already gitignored, and it makes
 * a package's own dist resolvable by the same name a consumer uses.
 *
 * Run after `bun install`. Idempotent, and it never replaces a real installed package.
 */
import { readFileSync } from "node:fs";
import { mkdirSync, readdirSync, statSync, symlinkSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", "dist", ".git", ".turbo", ".next"]);

type Walked = { manifestPath: string };

function walk(dir: string, out: Walked[]): void {
	for (const entry of readdirSync(dir)) {
		if (SKIP.has(entry)) continue;
		const full = join(dir, entry);
		let stat;
		try {
			stat = statSync(full);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			walk(full, out);
		} else if (entry === "package.json") {
			out.push({ manifestPath: full });
		}
	}
}

let created = 0;
let present = 0;
const skipped: string[] = [];

for (const base of ["apps", "packages", "tooling", "infra"]) {
	const baseDir = join(ROOT, base);
	if (!existsSync(baseDir)) continue;

	const manifests: Walked[] = [];
	walk(baseDir, manifests);

	for (const { manifestPath } of manifests) {
		let name: string | undefined;
		try {
			name = (JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string }).name;
		} catch {
			continue;
		}
		if (!name || !name.includes("/")) continue;

		const pkgDir = dirname(manifestPath);
		const [scope, bare] = name.split("/") as [string, string];
		const linkDir = join(pkgDir, "node_modules", scope);
		const link = join(linkDir, bare);

		if (existsSync(link)) {
			present += 1;
			continue;
		}

		mkdirSync(linkDir, { recursive: true });
		try {
			symlinkSync(relative(linkDir, pkgDir), link, "dir");
			created += 1;
		} catch (error) {
			skipped.push(`${name}: ${(error as Error).message}`);
		}
	}
}

console.log(`self-links created: ${created}`);
console.log(`already present:    ${present}`);
if (skipped.length > 0) {
	console.log(`skipped (${skipped.length}):`);
	for (const s of skipped.slice(0, 10)) console.log(`  ${s}`);
}
