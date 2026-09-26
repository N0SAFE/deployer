import "reflect-metadata";

/**
 * Boot check for the setup app — assemble the whole Nest graph, then exit.
 *
 * WHY THIS EXISTS AS AN ENTRY POINT AND NOT ONLY AS A TEST
 * `type-check` proves the code compiles. It proves NOTHING about whether Nest
 * can assemble the application: a provider whose dependency is not exported, a
 * `@Inject(TOKEN)` whose token nobody binds, a module that imports something
 * absent — all type-check cleanly and then fail at `NestFactory.create()`.
 *
 * Those failures were real here: the app had never been booted, and doing so
 * surfaced an `UnknownExportException` on `EnvService` and an unsupported route
 * path that `tsc` had been perfectly happy with.
 *
 * WHAT IT BUILDS, AND WHY NOT THE HTTP APP
 * `createCompileContext()` returns `NestFactory.createApplicationContext(...)`
 * — it resolves every module, provider and `onModuleInit`, which is where DI
 * defects live, while creating NO HTTP adapter and binding NO port. The spec in
 * the same app builds the graph through `Test.createTestingModule` instead: the
 * two answer different questions (`spec` = the module graph, fast and parallel;
 * `compile.ts` = the shared factory's configuration, from the bundled artifact
 * that ships) and both are wanted.
 *
 * SIDE EFFECTS ARE REAL. `onModuleInit` hooks run, so a provider that opens a
 * connection at init will try to. That is the point: the check exists to catch
 * exactly that class of failure. `NODE_ENV` is forced to `test` so the app does
 * not attempt production-only work (migrations, supervisor convergence).
 */
process.env.NODE_ENV = "test";

/**
 * Redirect the local SQLite file away from the container path.
 *
 * The schema defaults to `/app/data/local.db` — correct INSIDE the container,
 * and unwritable everywhere else. Without this the check dies with
 * `EACCES: permission denied, mkdir '/app/data'` on a developer's machine and in
 * CI, which says nothing about the DI graph it exists to verify.
 *
 * This is the same override, for the same reason, as `vitest.setup.ts` — which
 * also notes the second benefit: a real path would run the app's migrations
 * against a shared database.
 *
 * `??` so an explicit value in the environment still wins.
 */
process.env.NODE_LOCAL_DB_PATH =
  process.env.NODE_LOCAL_DB_PATH ?? "/tmp/deployer-setup-compile-local.db";

async function main(): Promise<void> {
  // Imported AFTER NODE_ENV is set: the env schema is parsed at module load, so
  // the order here decides which environment the check runs as.
  const { createCompileContext } = await import("./app.config");

  const app = await createCompileContext();

  // `close()` runs the shutdown hooks, so a provider that failed to register a
  // cleanup is caught here too.
  await app.close();

  console.log("✅ compile: setup app assembled and closed cleanly");
}

main().catch((error: unknown) => {
  // A non-zero exit is the whole signal. The message is printed plainly because
  // Nest's own boot errors are already descriptive — wrapping them would hide
  // the "Is X part of the relevant providers?" hint that names the fix.
  console.error("❌ compile: setup app FAILED to assemble");
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack !== undefined) {
    console.error(error.stack);
  }
  process.exit(1);
});
