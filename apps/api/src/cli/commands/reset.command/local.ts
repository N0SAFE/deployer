import { Logger } from '@nestjs/common';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as localSchema from '@repo/nest-schema/local';

/**
 * Drop every table in the local SQLite file.
 *
 * THE TABLE LIST IS READ FROM SQLITE, NOT HARDCODED. It used to name three
 * tables by hand — `node_mesh_config`, `node_config`, `__drizzle_migrations` —
 * and every part of that was wrong by the time it ran:
 *
 *  - `__drizzle_migrations` is DRIZZLE'S GLOBAL POSTGRES TABLE. It has never
 *    existed in this file, so the state table was never dropped.
 *  - The real state table is `local_migrations` (see `@repo/nest-database-local`),
 *    so a reset left it FULL while emptying the schema: the next boot saw every
 *    migration as already applied, skipped them all, and started with no tables
 *    at all. A silent success that breaks the app one boot later.
 *  - Four tables the schema defines — `cluster_master_history`, `cluster_node`,
 *    `cluster_nodes`, `platform_settings` — were never in the list, so they
 *    survived a "reset".
 *
 * Reading `sqlite_master` removes the list, which is the only way it cannot
 * drift again: the database already knows what it contains.
 *
 * `sqlite_%` is excluded because those are SQLite's own bookkeeping tables
 * (`sqlite_sequence`, …) — dropping them is not what a reset means.
 *
 * FOREIGN KEYS ARE DISABLED FOR THE DROPS, because `PRAGMA foreign_keys` is left
 * ON by `0004_violet_sandman.sql` and SQLite refuses to drop a table that a
 * remaining table still references. Dropping in `sqlite_master` order would work
 * for TODAY's schema and fail the moment a migration adds a reference in the
 * other direction — so the guard is on the drop, not on the ordering.
 * `PRAGMA foreign_keys` is a no-op inside a transaction, so this must stay a
 * bare statement.
 */
export function resetLocal(localDb: BunSQLiteDatabase<typeof localSchema>): void {
  const logger = new Logger('resetLocal');

  const tables = localDb.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ) as { name: string }[];

  localDb.run("PRAGMA foreign_keys=OFF");
  // Quoted because the names come from the database rather than from literals —
  // `cluster_nodes` needs no quoting today, but a name that is a keyword or
  // contains a dot would make the statement fail where nobody is reading.
  for (const { name } of tables) {
    localDb.run(`DROP TABLE IF EXISTS "${name}"`);
  }
  localDb.run("PRAGMA foreign_keys=ON");

  logger.log(`✅ Local database reset completed — ${String(tables.length)} tables dropped`);
}
