/**
 * Test-environment setup for the setup app.
 *
 * Runs BEFORE any module is imported, so the env schema sees these values when
 * it parses `process.env` at load.
 */
import "reflect-metadata";

process.env.NODE_ENV = "test";

/**
 * The local SQLite file the app opens at module init.
 *
 * The schema defaults to `/app/data/local.db` — the CONTAINER path, which is
 * correct in production and unwritable outside it. Without this override the
 * module-graph spec fails with `EACCES: permission denied, mkdir '/app/data'`
 * (and, worse, would run the real migrations against a shared file). A per-test
 * path under the OS temp dir keeps the run hermetic.
 *
 * `??` so an explicit value in the environment still wins.
 */
process.env.NODE_LOCAL_DB_PATH =
  process.env.NODE_LOCAL_DB_PATH ?? "/tmp/deployer-setup-test-local.db";
