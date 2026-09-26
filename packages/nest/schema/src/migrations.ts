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
export const LOCAL_MIGRATIONS_DIR = fileURLToPath(
  new URL("../migrations/local", import.meta.url),
);
