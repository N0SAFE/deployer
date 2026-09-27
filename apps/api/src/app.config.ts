import { NestFactory } from "@nestjs/core";
import type { NestApplicationOptions } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";

import { buildAllowedOrigins, resolveCorsDecision, CORS_ALLOWED_HEADERS } from "./core/utils/cors.utils";
import { createViteAssetsMiddleware } from "./core/gateway-assets/vite-assets.middleware";
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
 * BOTH NOW BUILD `AppModule`. They used to differ — `main.ts` built
 * `OrchestrationModule` (a gateway that spawned sub-apps in their own processes)
 * while `compile.ts` built `AppModule` — because the API could be launched
 * before setup had run and therefore needed a pre-setup surface.
 *
 * That phase belongs to `apps/setup` now, which is its own process. The API only
 * ever starts AFTER setup, so it is a single normal application: one graph, no
 * sub-apps, and the entry check exercises exactly what ships.
 */

/**
 * The single externally-visible HTTP port.
 *
 * There is no longer any internal per-sub-app port to be distinguished from
 * this one: the app is one process listening here, and Traefik routes to it.
 */
export const API_PORT = Number(process.env.API_PORT ?? 3005);

/**
 * `NestFactory` options shared by every entry point.
 *
 * `bodyParser: false` because `main.ts` hands Nest an Express instance it built
 * itself — with CORS, `/health` and the Vite asset middleware already attached —
 * so Express must not parse the body twice. `snapshot` is off in production: it
 * exists to make a dev boot legible, and it costs a trace of the whole bootstrap
 * on every start.
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
 * The Express server the app runs on, with its non-Nest middleware applied.
 *
 * ORDER IS THE CONTRACT:
 *   1. CORS                      — must answer preflight before anything else.
 *   2. Vite dev assets (`/vite`) — the SSR views' client bundle. These are NOT
 *      API routes: they must not reach the controller layer, and they must not
 *      be subject to the auth guard (they are identical static build output for
 *      every user). Mounted here, ahead of Nest, which is also what keeps them
 *      working now that the gateway's catch-all — which used to exempt them
 *      specially — is gone.
 *
 * `main.ts` adds `/health` and `/health/ready` on top of this, because both must
 * answer while Nest is still booting.
 */
export function createGateway(): express.Express {
  const gateway = express();
  gateway.use(createCorsMiddleware());
  gateway.use(createViteAssetsMiddleware());
  return gateway;
}

/**
 * Create the application, UNSTARTED.
 *
 * Deliberately not `createApplicationContext`: that skips the HTTP adapter, so
 * the factory would validate a different construction path than `main.ts` uses.
 * This returns exactly the application `main.ts` runs.
 */
export async function createApiApp(gateway: express.Express) {
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(gateway),
    apiAppOptions(),
  );

  app.enableShutdownHooks();
  await app.init();

  return app;
}

/**
 * Build the graph without an HTTP adapter, listening on nothing.
 *
 * Used by `compile.ts`. `createApplicationContext` resolves modules, providers
 * and `onModuleInit` — the class of failure `tsc` cannot see — while creating no
 * server. Same module as `createApiApp`, so the check covers what ships.
 */
export async function createCompileContext() {
  return NestFactory.createApplicationContext(AppModule, apiAppOptions());
}
