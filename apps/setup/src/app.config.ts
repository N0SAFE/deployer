import { NestFactory } from "@nestjs/core";
import type { NestApplicationOptions } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";
import { createViteAssetsMiddleware } from "@repo/vite-assets";

import { SetupAppModule } from "./app.module";
import { setupEnvSchema } from "./config/env/env.schema";
import { createSetupAuthProxy } from "./middleware/setup-auth-proxy";

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
  // The Express instance is built here so the SSR wizard's client bundle can be
  // proxied BEFORE Nest's router. The assets are not app routes — they must not
  // reach the controller layer, and they must not be refused by anything that
  // wraps it (the wizard is pre-auth, but its own bundle is static output).
  //
  // 5174 is THIS app's Vite dev server; the API's is 5173. Without this the
  // wizard renders but every asset 404s, because the SSR template emits
  // `/vite/@vite/client` and nothing is listening for it.
  const server = express();
  server.use(express.json());
  server.use(createViteAssetsMiddleware({ port: 5174 }));

  // `/api/auth/*` is served by the API but reached through THIS host: the
  // wizard's sign-in step calls it with a relative path (see `views/lib/auth.ts`),
  // so it lands on whichever origin served the page. Without this the operator's
  // final step failed with `Cannot POST /api/auth/sign-in/email` — and, because
  // the sign-in precedes the trigger, the run then reported the API as
  // unreachable, which described the symptom rather than the cause.
  //
  // Mounted BEFORE the Nest router for the same reason as the asset proxy: it is
  // not an app route, and the API does not exist yet when the first call arrives.
  server.use(createSetupAuthProxy(setupEnv.SETUP_API_URL ?? "http://api-dev:3005"));

  const app = await NestFactory.create(SetupAppModule, new ExpressAdapter(server), setupAppOptions());
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
