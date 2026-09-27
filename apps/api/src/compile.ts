import "reflect-metadata";

/**
 * Boot check for the API — assemble the real Nest graph, then exit.
 *
 * WHY THIS EXISTS AS AN ENTRY POINT AND NOT ONLY AS A TEST
 * `type-check` proves the code compiles. It proves NOTHING about whether Nest
 * can assemble the application: a provider whose dependency is not exported, an
 * `@Inject(TOKEN)` nobody binds, a module importing something absent — all
 * type-check cleanly and then fail at boot. Those failures were real here: the
 * setup app had never been booted and surfaced an `UnknownExportException` plus
 * a `NodesModule` dependency that could not resolve, both invisible to `tsc`.
 *
 * WHAT IT BUILDS, AND WHY NOT THE GATEWAY
 * `createCompileContext()` builds `AppModule` — the feature graph (auth, ORPC,
 * health, every product module). It deliberately does NOT build
 * `OrchestrationModule`: that is the gateway, whose `onApplicationBootstrap`
 * SPAWNS SUB-APPS in their own processes. A compile check must not start
 * services, and `AppModule` is the harder graph anyway (225+ routes, the whole
 * DI surface), so checking it is the stronger guarantee.
 *
 * WHAT IT DOES NOT DO
 * No HTTP adapter listens: `createApplicationContext` skips the server
 * entirely, so no port is bound. Safe alongside a live dev stack and in CI
 * where no Docker network exists.
 *
 * SIDE EFFECTS ARE REAL. `onModuleInit` runs, so a provider that opens a
 * connection at init will try to. That is the point — it is exactly the class
 * of failure this catches. `NODE_ENV` is forced to `test` so the app does not
 * attempt production-only work (migrations, supervisor convergence).
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
  process.env.NODE_LOCAL_DB_PATH ?? "/tmp/deployer-api-compile-local.db";

async function main(): Promise<void> {
  // Imported AFTER NODE_ENV is set: the env schema is parsed at module load, so
  // the order here decides which environment the check runs as.
  const { createCompileContext } = await import("./app.config");

  const app = await createCompileContext();

  // `close()` runs the shutdown hooks, so a provider that failed to register a
  // cleanup is caught here too.
  await app.close();

  console.log("✅ compile: api feature graph assembled and closed cleanly");

  // Exit EXPLICITLY. `close()` releasing Nest's own resources is not enough:
  // booting the real graph leaves handles behind (mesh dispatchers, the
  // supervisor, timers registered by providers) that the shutdown hooks do not
  // cover. Without this the check printed its success line, then hung forever.
  //
  // That hang was not cosmetic: `scripts/build.ts` awaits the child's `exit`
  // event, so the promise never settled and `build` never returned — the CI
  // compile step blocked until the job timed out. An explicit exit turns
  // "cleanly shut down" into an observable completion.
  //
  // Zero because reaching this line IS the pass condition: the graph assembled
  // and closed without throwing.
  process.exit(0);
}

main().catch((error: unknown) => {
  // A non-zero exit is the whole signal. The message is printed plainly because
  // Nest's own boot errors are already descriptive — wrapping them would hide
  // the "Is X part of the relevant providers?" hint that names the fix.
  console.error("❌ compile: api feature graph FAILED to assemble");
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack !== undefined) {
    console.error(error.stack);
  }
  process.exit(1);
});
