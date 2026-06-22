#!/usr/bin/env -S bun
/**
 * Debug File System Change Watcher
 * ==================================
 * Spawned by entrypoint.dev.ts when NEXT_DEBUG_COMPILE=1.
 * Watches key project directories and logs all file system events
 * to help correlate on-disk changes with webpack recompilations.
 *
 * Output is prefixed with [DEBUG:FS] for easy filtering.
 */

import { watch } from "fs";
import { join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..");

// Directories to watch (relative to apps/web/)
const WATCH_DIRS = [
  "src", // Next.js app source
  "../../packages/ui/base/src", // @repo/ui source
  "../../packages/ui/base/dist", // @repo/ui output
  "../../packages/contracts/api/modules", // API contracts
  "../../packages/contracts/api/common", // API contract commons
  "../../packages/contracts/api/scripts", // contracts build scripts
  "../../packages/utils/orpc", // ORPC utilities
  "scripts", // entrypoint etc.
];

interface DebouncedDir {
  timer: ReturnType<typeof setTimeout> | null;
  pending: Set<string>;
}

const debounceMap = new Map<string, DebouncedDir>();

function flushPending(dir: string, dd: DebouncedDir): void {
  if (dd.pending.size === 0) return;
  // Show first few + count
  const files = [...dd.pending].slice(0, 5);
  const remaining = dd.pending.size - files.length;
  console.log(
    `[DEBUG:FS] Changes in ${dir}${remaining > 0 ? ` (${dd.pending.size} total)` : ""}:`,
  );
  for (const f of files) {
    console.log(`  ${f}`);
  }
  if (remaining > 0) {
    console.log(`  … and ${remaining} more file(s)`);
  }
  dd.pending.clear();
}

/**
 * Watch a directory for changes with debouncing (500 ms).
 * Uses Node's native fs.watch (non-recursive on Linux).
 */
function watchDir(dirRel: string): void {
  const dirAbs = resolve(ROOT, dirRel);

  const dd: DebouncedDir = { timer: null, pending: new Set() };
  debounceMap.set(dirAbs, dd);

  try {
    const watcher = watch(dirAbs, { recursive: false }, (eventType, filename) => {
      if (!filename) return;

      // Ignore hidden files, node_modules, .git, etc
      const filenameStr = filename.toString();
      if (
        filenameStr.startsWith(".") ||
        filenameStr.includes("node_modules") ||
        filenameStr.includes(".git") ||
        filenameStr.endsWith(".sock")
      ) {
        return;
      }

      const fullPath = join(dirAbs, filenameStr);
      const relPath = relative(ROOT, fullPath);
      dd.pending.add(relPath);

      if (dd.timer) clearTimeout(dd.timer);
      dd.timer = setTimeout(() => flushPending(dirRel, dd), 500);
    });

    watcher.on("error", (err) => {
      console.log(`[DEBUG:FS] Watch error on ${dirRel}: ${err.message}`);
    });

    console.log(`[DEBUG:FS] Watching ${dirRel}`);
  } catch (err: any) {
    console.log(`[DEBUG:FS] Cannot watch ${dirRel}: ${err.message} (directory may not exist yet)`);
  }
}

// ── Main ──────────────────────────────────────────────────────────

console.log(`[DEBUG:FS] File system watcher started`);
console.log(`[DEBUG:FS] Root: ${ROOT}`);
console.log(`[DEBUG:FS] Watching ${WATCH_DIRS.length} directories`);
console.log(``);

for (const d of WATCH_DIRS) {
  watchDir(d);
}

// Keep alive
process.on("SIGTERM", () => {
  console.log(`[DEBUG:FS] Shutting down`);
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log(`[DEBUG:FS] Shutting down`);
  process.exit(0);
});
