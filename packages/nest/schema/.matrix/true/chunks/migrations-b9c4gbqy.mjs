// packages/nest/schema/src/migrations.ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var LOCAL_MIGRATIONS_DIR2 = resolveLocalMigrationsDir();
function resolveLocalMigrationsDir() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;; ) {
    const candidate = join(dir, "migrations", "local");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Local migrations directory not found above ${fileURLToPath(import.meta.url)}`);
    }
    dir = parent;
  }
}
var GLOBAL_MIGRATIONS_DIR2 = resolveGlobalMigrationsDir();
function resolveGlobalMigrationsDir() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;; ) {
    const candidate = join(dir, "migrations", "global");
    if (existsSync(join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Global migrations directory not found above ${fileURLToPath(import.meta.url)}`);
    }
    dir = parent;
  }
}

export { LOCAL_MIGRATIONS_DIR2, GLOBAL_MIGRATIONS_DIR2 };
