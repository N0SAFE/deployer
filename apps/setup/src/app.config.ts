import { NestFactory } from "@nestjs/core";
import type { NestApplicationOptions } from "@nestjs/common";

import { SetupAppModule } from "./app.module";
import { setupEnvSchema } from "./config/env/env.schema";

/**
 * The ONE place the setup app's Nest configuration is decided.
 *
 * WHY A SHARED FACTORY RATHER THAN CONFIG IN `main.ts`
 * `main.ts` and `compile.ts` must build the SAME application. If each declared
 * its own `NestFactory` options, a check that passes in `compile.ts` would say
 * nothing about what `main.ts` actually starts — the two could drift silently
 * (a different `snapshot` flag, a forgotten `abortOnError`, a logger level) and
 * the compile check would keep reporting green.
 *
 * So the configuration lives here, and both entry points consume it:
 *
 *   main.ts     -> createSetupApp() then `.listen(port)`
 *   compile.ts  -> createSetupApp() then `.close()`
 *
 * The factory returns a real application (not an initialised one), so the
 * caller decides whether to listen or to close.
 */

/**
 * Read config through the app's own schema rather than raw `process.env`.
 *
 * `setupEnvSchema` supplies the default and the coercion, so this stays in sync
 * with whatever the schema declares — a hand-written `?? 3016` would silently
 * drift from it.
 */
export const setupEnv = setupEnvSchema.parse(process.env);

/** The port the setup app binds. Exported so `main.ts` can log it. */
export const SETUP_PORT = setupEnv.SETUP_APP_PORT;

/**
 * `NestFactory` options, shared by every entry point.
 *
 * `snapshot` is off in production: it exists to make a dev boot legible, and it
 * costs a trace of the whole bootstrap on every start.
 */
export function setupAppOptions(): NestApplicationOptions {
  return {
    snapshot: setupEnv.NODE_ENV !== "production",
  };
}

/**
 * Create the setup application, UNSTARTED.
 *
 * Deliberately not `NestFactory.createApplicationContext`: that skips the HTTP
 * adapter, so `compile.ts` would validate a different construction path than
 * `main.ts` uses. This returns exactly what `main.ts` listens on.
 */
export async function createSetupApp() {
  const app = await NestFactory.create(SetupAppModule, setupAppOptions());
  app.enableShutdownHooks();
  return app;
}

/**
 * Build the module graph WITHOUT an HTTP adapter, for the `compile.ts` gate.
 *
 * `createApplicationContext` resolves every module, provider and
 * `onModuleInit` — the class of failure `tsc` cannot see — while binding no
 * port. `NestFactory.create` would do the same PLUS stand up an Express
 * server, which the check has no use for: it exists to prove the graph
 * assembles, and a bound socket is a runtime concern that would also make the
 * check unable to run next to a live dev stack.
 *
 * It shares `setupAppOptions()`, so the one configuration both entry points
 * depend on cannot drift between them.
 */
export async function createCompileContext() {
  return NestFactory.createApplicationContext(SetupAppModule, setupAppOptions());
}

/** Where an operator should point a browser — the public host, not the port. */
export function setupPublicUrl(): string {
  const prefix = setupEnv.DEPLOYER_PREFIX;
  return prefix === ""
    ? "setup.deployer.localhost"
    : `setup.${prefix}deployer.localhost`;
}
