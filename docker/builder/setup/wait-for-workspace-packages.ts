#!/usr/bin/env bun
/**
 * wait-for-workspace-packages — block until the app's workspace imports resolve.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `turbo run dev --filter=<app>...` starts the app and the workspace-package
 * watchers IN PARALLEL. `pkg-build --watch` begins each rebuild by DELETING the
 * package's `dist/` (`fs.rmSync(distDir)`) and only then writes it back, so an app
 * that boots at the same moment resolves its imports against a partially empty
 * tree. Observed in order as the app got further before dying:
 *
 *   Cannot find module '@repo/ui/components/setup/setup-wizard'
 *   Cannot find module '@repo/nest-schema/migrations'
 *   Cannot find module '@repo/orpc-utils'
 *
 * Building the packages in the image does NOT remove the race: the watcher wipes
 * that output as soon as it starts. The app must WAIT.
 *
 * ── WHY THIS ASKS THE RIGHT QUESTION ────────────────────────────────────────
 * Three earlier attempts each measured something that was not the invariant:
 *
 *   1. `[ -f .../setup-wizard.mjs ]` — FILE EXISTENCE. The image had already
 *      built that file, so the test passed instantly and waited for nothing.
 *   2. `Bun.resolveSync` on ONE package — real, but the packages rebuild in
 *      PARALLEL and finish at different times. `@repo/ui` being ready said
 *      nothing about `@repo/orpc-utils`, and the app died on the next import.
 *   3. Every `@repo/*` DEPENDENCY — but some are config-only
 *      (`@repo/config-typescript`), have no `exports`, and can never resolve.
 *      Waiting on them would time out on a package that was never importable.
 *
 * The invariant is: **every `@repo/*` specifier the app's SOURCE actually
 * imports must resolve.** So that is exactly what this checks — by scanning the
 * source, not by guessing from the manifest. A dependency the app does not import
 * cannot block startup, and a package the app newly starts importing is picked up
 * automatically.
 *
 * ── WHY TWO CONSECUTIVE CLEAN PASSES ────────────────────────────────────────
 * A single pass can land in the gap between package A finishing and package B
 * being wiped. Requiring the whole set to resolve twice, one interval apart,
 * means every watcher has completed its destructive phase before the app starts.
 *
 * Exits non-zero on timeout rather than waiting forever, so a package that never
 * builds is a visible container failure instead of a silent hang.
 *
 * Usage: wait-for-workspace-packages <app-dir>   (default: /app/apps/setup)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const appDir = process.argv[2] ?? "/app/apps/setup";
const srcDir = path.join(appDir, "src");

const PASSES_REQUIRED = 2;
const INTERVAL_MS = 3_000;
const TIMEOUT_MS = 600_000;

/** Every file under `dir`, recursively, filtered to the extensions we scan. */
function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }

    if (isDir) {
      // `node_modules` cannot appear under `src`, but skipping it costs nothing
      // and keeps the scan bounded if the layout ever changes.
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry)) {
      out.push(full);
    }
  }

  return out;
}

/**
 * Every external specifier the app's source imports.
 *
 * Matches both static (`from "x"`) and dynamic (`import("x")`) forms, and both
 * quote styles — a missed form would mean a package that is never waited on, i.e.
 * the exact race this script exists to close.
 */
function importedSpecifiers(): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /from\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const file of walk(srcDir)) {
    const text = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        specifiers.add(match[1]);
      }
    }
  }

  return [...specifiers];
}

/**
 * Reduce a specifier to the package that must be resolvable.
 *
 * `@repo/ui/components/setup/setup-wizard` → `@repo/ui`. Resolving the FULL
 * specifier is stronger, but it would fail for a subpath a package exports lazily;
 * the package root is the right granularity — if the package resolves at all, its
 * watcher has finished writing.
 */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  if (specifier.startsWith("@/")) return null;
  if (specifier.startsWith("node:")) return null;

  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  return name.startsWith("@repo/") ? name : null;
}

const required = [
  ...new Set(
    importedSpecifiers()
      .map(packageOf)
      .filter((name): name is string => name !== null),
  ),
].sort();

console.log(
  `wait-for-workspace-packages: ${String(required.length)} workspace packages imported by the app`,
);

if (required.length === 0) {
  console.log("wait-for-workspace-packages: none — nothing to wait for");
  process.exit(0);
}

/** Which of `required` cannot be resolved from the app's source directory. */
function unresolved(): string[] {
  return required.filter((name) => {
    try {
      Bun.resolveSync(name, srcDir);
      return false;
    } catch {
      return true;
    }
  });
}

const startedAt = Date.now();
let cleanPasses = 0;

while (cleanPasses < PASSES_REQUIRED) {
  const missing = unresolved();

  if (missing.length === 0) {
    cleanPasses += 1;
    console.log(
      `wait-for-workspace-packages: clean pass ${String(cleanPasses)}/${String(PASSES_REQUIRED)}`,
    );
  } else {
    // Any missing package resets the count: the tree was mid-rebuild, so a
    // previous clean pass says nothing about the state after this wipe.
    cleanPasses = 0;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `wait-for-workspace-packages: [${String(elapsed)}s] waiting for ${missing.join(", ")}`,
    );

    if (Date.now() - startedAt >= TIMEOUT_MS) {
      console.error(
        `wait-for-workspace-packages: TIMED OUT after ${String(TIMEOUT_MS / 1000)}s — ` +
          `these never became resolvable: ${missing.join(", ")}`,
      );
      process.exit(1);
    }
  }

  if (cleanPasses < PASSES_REQUIRED) {
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

console.log("wait-for-workspace-packages: all packages resolvable — the app may start");
