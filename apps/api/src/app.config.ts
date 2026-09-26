import { NestFactory } from "@nestjs/core";
import type { NestApplicationOptions } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";

import { buildAllowedOrigins, resolveCorsDecision, CORS_ALLOWED_HEADERS } from "./core/utils/cors.utils";
import { OrchestrationModule } from "./core/orchestrator/orchestrator.module";
import { AppModule } from "./app.module";

/**
 * The ONE place the API's Nest configuration is decided.
 *
 * WHY A SHARED FACTORY RATHER THAN CONFIG IN `main.ts`
 * `main.ts` and `compile.ts` must build the SAME application. If each declared
 * its own `NestFactory` options, a check that passes in `compile.ts` would say
 * nothing about what `main.ts` actually starts — the two could drift silently
 * (a different `bodyParser` flag, a forgotten `snapshot`, a logger level) and
 * the compile check would keep reporting green.
 *
 * So the configuration lives here, and both entry points consume it:
 *
 *   main.ts     -> createApiApp(gateway)   then run
 *   compile.ts  -> createCompileContext()  then close
 *
 * The two functions differ deliberately in WHICH module they build:
 *
 *   createApiApp()          builds `OrchestrationModule` — the gateway that
 *                           owns the sub-app pipeline. This is what ships.
 *   createCompileContext()  builds `AppModule` — the real feature graph (auth,
 *                           ORPC, health, every product module) WITHOUT the
 *                           sub-app orchestration. Assembling the gateway would
 *                           spawn sub-apps in their own processes, which is a
 *                           runtime concern the check must not trigger.
 *
 * `AppModule` is the harder graph (225+ routes, the whole DI surface), so
 * checking it is the stronger guarantee.
 */

/**
 * The single externally-visible HTTP port.
 *
 * All feature sub-apps run on their own internal ports and are proxied through
 * the gateway's route graph; only this one is published.
 */
export const API_PORT = Number(process.env.API_PORT ?? 3005);

/**
 * `NestFactory` options shared by every entry point.
 *
 * `bodyParser: false` because the gateway attaches Nest to an Express instance
 * it created itself and configures CORS/health on — Express must not parse the
 * body twice. `snapshot` is off in production: it exists to make a dev boot
 * legible, and it costs a trace of the whole bootstrap on every start.
 */
export function apiAppOptions(): NestApplicationOptions {
  return {
    snapshot: process.env.NODE_ENV !== "production",
    bodyParser: false,
  };
}

/**
 * CORS middleware for the gateway.
 *
 * Cookie presence separates the credentialed (allowlisted) path from the
 * credential-free app-instance-token path — see `resolveCorsDecision`.
 */
export function createCorsMiddleware(): express.RequestHandler {
  const corsAllowedOrigins = buildAllowedOrigins(
    process.env as Record<string, string | undefined>,
  );
  const isDevelopment = process.env.NODE_ENV !== "production";

  return (req, res, next) => {
    const cookieHeader = req.headers.cookie;
    const hasCookieHeader =
      typeof cookieHeader === "string" && cookieHeader.length > 0;

    const decision = resolveCorsDecision({
      origin: req.headers.origin,
      hasCookieHeader,
      allowedOrigins: corsAllowedOrigins,
      isDevelopment,
    });

    if (decision.allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
      if (decision.allowCredentials) {
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Expose-Headers", "Set-Cookie");
      }
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        CORS_ALLOWED_HEADERS.join(", "),
      );
    }

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

/**
 * The Express server the gateway runs on, with CORS already applied.
 *
 * Returned unstarted: `main.ts` listens on it immediately (so health probes
 * answer while Nest is still booting) while `compile.ts` never listens at all.
 */
export function createGateway(): express.Express {
  const gateway = express();
  gateway.use(createCorsMiddleware());
  return gateway;
}

/**
 * Create the gateway application, UNSTARTED.
 *
 * Deliberately not `createApplicationContext`: that skips the HTTP adapter, so
 * the factory would validate a different construction path than `main.ts` uses.
 * This returns exactly the application `main.ts` runs.
 *
 * `init()` IS called, because that is what resolves the DI graph and fires
 * `onModuleInit` / `onApplicationBootstrap` — without it the check would prove
 * almost nothing.
 */
export async function createApiApp(gateway: express.Express) {
  const app = await NestFactory.create(
    OrchestrationModule,
    new ExpressAdapter(gateway),
    apiAppOptions(),
  );

  app.enableShutdownHooks();
  await app.init();

  return app;
}

/**
 * Build the FEATURE graph (`AppModule`) without starting anything.
 *
 * Used by `compile.ts`. `createApplicationContext` resolves modules,
 * providers and `onModuleInit` — the class of failure `tsc` cannot see — while
 * creating no HTTP adapter and listening on no port.
 */
export async function createCompileContext() {
  return NestFactory.createApplicationContext(AppModule, apiAppOptions());
}
