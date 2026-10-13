import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute path to the LOCAL (SQLite) migration files.
 *
 * WHY THIS LIVES IN THE SCHEMA PACKAGE
 * The migrations create the tables this package DEFINES (`node_config`,
 * `node_mesh_config`, `cluster_node`, …). A migration file and the table
 * definition it corresponds to are two halves of one fact, so keeping them
 * together is what makes drift visible: a column added to `local/node-config`
 * without a migration is a gap you can see in one directory listing.
 *
 * They used to live in `apps/api/src/config/drizzle/local/migrations`, which
 * meant any second app needing the same tables had to keep a duplicate copy —
 * and `apps/setup` does need them (it reads `node_config` for the swarm
 * participation decision). One set, in one place, both apps read it.
 *
 * Resolved relative to THIS module, so it stays correct regardless of the
 * process working directory — the failure mode of a cwd-relative path is a
 * silently skipped migration and an app that boots against a stale schema.
 */
export const LOCAL_MIGRATIONS_DIR = resolveLocalMigrationsDir();

/**
 * Walk up from this module until a `migrations/local` directory is found.
 *
 * A fixed relative path is wrong for the BUNDLED build: the bundler hoists this
 * code into `dist/esm/chunks/*.mjs`, so `../migrations/local` pointed at
 * `dist/esm/migrations/local` (absent) and the runner skipped every migration -
 * the app then failed with "no such table: node_config". Searching upward finds
 * `<pkg>/migrations/local` from source and `<pkg>/dist/migrations/local` from
 * any bundle depth.
 */
function resolveLocalMigrationsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "migrations", "local");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Local migrations directory not found above ${fileURLToPath(import.meta.url)}`,
      );
    }
    dir = parent;
  }
}

/**
 * Absolute path to the GLOBAL (Postgres) migration files.
 *
 * ── WHY THIS MOVED HERE FROM THE APP ────────────────────────────────────────
 * It used to be `apps/api/src/config/drizzle/global/migrations`, computed
 * independently by three callers as a `../..` count from their own file. When
 * `src/config` was relocated under `shared/`, all three kept pointing at the old
 * location and the migrator began reporting `Can't find meta/_journal.json file`
 * while APPLYING NOTHING — a failure that looks like success.
 *
 * Hosting it beside the tables those migrations create is what makes the pairing
 * checkable: a column added to `src/global/*` without a corresponding migration is
 * a gap visible in one directory listing. It also gives the repository ONE global
 * journal and ONE destination, so "what is the current schema" has a single answer
 * instead of one per app.
 *
 * The marker is the journal, not the directory: `drizzle-kit generate` writes both
 * together, so an empty leftover directory does not pass for migrations.
 */
export const GLOBAL_MIGRATIONS_DIR = resolveGlobalMigrationsDir();

function resolveGlobalMigrationsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "migrations", "global");
    if (existsSync(join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Global migrations directory not found above ${fileURLToPath(import.meta.url)}`,
      );
    }
    dir = parent;
  }
}
