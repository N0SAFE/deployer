// ─── Dev-mode env var (optional) ───────────────────────────────────────────
// Docker Compose can pass SETUP_AUTO=true via environment to auto-provision
// Postgres. If not set, the app starts without a database and you can run
// the setup wizard manually via the web UI.
// This env var is NOT forced here — the user controls it via .env or docker env.

import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import http from "node:http";
import express from "express";

import {
  buildAllowedOrigins,
  resolveCorsDecision,
  CORS_ALLOWED_HEADERS,
} from "./core/utils/cors.utils";
import { logger } from "@repo/logger";
import { RouteRegistryService } from "./core/gateway/route-registry.service";
import { OrchestrationModule } from "./core/orchestrator/orchestrator.module";
import { OrchestratorService } from "./core/orchestrator/orchestrator.service";

const log = logger.scope("GatewayOrchestrator");

/**
 * Maximum time we allow NestJS to spend running `onModuleDestroy` /
 * `beforeApplicationShutdown` / `onApplicationShutdown` hooks after a
 * SIGINT/SIGTERM (or `app.close()`) before we force-exit the process.
 */
const SHUTDOWN_GRACEFUL_TIMEOUT_MS = 30_000;

// ─── Port Configuration ─────────────────────────────────────────────────────
// The gateway is the ONLY externally-visible HTTP server. All feature sub-apps
// run on independent internal ports, proxied through the gateway's route graph.
const GATEWAY_PORT = Number(process.env.API_PORT ?? 3005);

// ─── CORS ───────────────────────────────────────────────────────────────────
function createCorsMiddleware(): express.RequestHandler {
  const corsAllowedOrigins = buildAllowedOrigins(
    process.env as Record<string, string | undefined>,
  );
  const isDevelopment = process.env.NODE_ENV !== "production";

  return (req, res, next) => {
    // Cookie presence separates the credentialed (allowlisted) path from the
    // credential-free app-instance-token path — see resolveCorsDecision.
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

// ─── Bootstrap ──────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Gateway Express Server
  // ═══════════════════════════════════════════════════════════════════════════
  // A single Express server handles:
  //   1. CORS (all cross-origin traffic)
  //   2. /health endpoint (immediate, for Docker probes)
  //   3. NestJS OrchestrationModule (attached via ExpressAdapter) — manages
  //      the sub-app pipeline and proxies requests to registered sub-apps
  //
  // The server starts listening before NestJS init so health checks work immediately.

  const gateway = express();
  const routeRegistry = new RouteRegistryService();

  // CORS — runs before everything
  gateway.use(createCorsMiddleware());

  // Health endpoint — immediate response, for Docker health checks
  gateway.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  });

  // ── Readiness probe — the platform gate ───────────────────────────────────
  // Registered HERE for the same reason as `/health`: it must answer while Nest
  // is still booting, and the gateway catch-all would otherwise answer 503
  // "no sub-app registered" for a path that is deliberately not an API route.
  //
  // The probe is DELEGATED to the orchestrator because the readiness indicators
  // live in the main-app container (AppModule → HealthModule), which is a
  // separate Nest application on port 3012. The gateway container deliberately
  // does NOT own the global Postgres pool or the mesh repositories, so it
  // cannot answer this itself.
  //
  // Pre-setup the main-app does not exist yet and this answers 503 — which is
  // the truth, and exactly what compose must see while setup runs.
  let orchestrator: OrchestratorService | null = null;
  gateway.get("/health/ready", (_req, res) => {
    if (orchestrator === null) {
      res.status(503).json({ status: "error", error: { probe: { reason: "application is still starting" } } });
      return;
    }
    void orchestrator.probeReadiness().then((result) => {
      res.status(result.statusCode).json(result.body);
    });
  });

  // Start listening immediately so health checks succeed. The handle is kept
  // so shutdown can STOP ACCEPTING new connections and drain in-flight ones
  // (Nest never owns this server: we listen ourselves and hand the Express
  // instance to the adapter, so `app.close()` cannot close it).
  const gatewayServer = gateway.listen(GATEWAY_PORT, "0.0.0.0");
  log.info(`🚀 Gateway listening on port ${String(GATEWAY_PORT)}`);

  // Self-test: verify health endpoint responds
  await selfTestHealthEndpoint(GATEWAY_PORT);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: NestJS OrchestrationModule
  // ═══════════════════════════════════════════════════════════════════════════
  // Attach NestJS OrchestrationModule to the same Express server.
  // The OrchestratorService manages the entire sub-app pipeline:
  //   db-resolver (headless) → [setup-wizard if needed] → main-app (last)
  //
  // Express middleware order:
  //   CORS → /health (Express) → NestJS RouterController → NestJS 404/error
  //
  // Sub-apps import core modules directly. No shared providers are forwarded.

  const app = await NestFactory.create(
    OrchestrationModule,
    new ExpressAdapter(gateway),
    {
      snapshot: process.env.NODE_ENV !== "production",
      bodyParser: false,
    },
  );

  app.enableShutdownHooks();

  // Initialize — triggers OrchestratorService.onApplicationBootstrap()
  // which starts the sub-app pipeline.
  await app.init();

  // The readiness probe is answered by the ORCHESTRATOR, because the indicators
  // live in the main-app container (port 3012) — a separate Nest application
  // this gateway owns and starts after setup. Until it exists the route answers
  // 503 "still starting", which is accurate.
  orchestrator = app.get(OrchestratorService);

  log.info("✅ Orchestrator initialized — sub-app pipeline running");

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: Signal Handlers
  // ═══════════════════════════════════════════════════════════════════════════

  registerProcessSignalHandlers(app, routeRegistry, gatewayServer);
}

/**
 * Stop accepting NEW connections and wait (bounded) for in-flight requests.
 *
 * `server.close()` alone never resolves while keep-alive clients (browsers,
 * probes) hold idle sockets open, so idle connections are dropped explicitly;
 * only sockets actively serving a request keep the close pending. The caller
 * still bounds the total wait with the global shutdown timeout.
 */
async function drainHttpServer(server: http.Server | undefined): Promise<void> {
  if (server === undefined || !server.listening) {
    return;
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    // Drop idle keep-alive sockets; active requests are left to finish.
    server.closeIdleConnections?.();
  });
}
async function selfTestHealthEndpoint(port: number): Promise<void> {
  try {
    const resp = await new Promise<string>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${String(port)}/health`, (res) => {
        let data = "";
        res.on("data", (c: string) => (data += c));
        res.on("end", () => { resolve(`health=${data}`); });
      });
      req.on("error", reject);
      req.setTimeout(3000, () => {
        req.destroy();
        reject(new Error("timeout"));
      });
    });
    log.info(`✅ Health endpoint self-test: ${resp}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`❌ Health endpoint self-test FAILED: ${msg}`);
  }
}

// ─── Shutdown ───────────────────────────────────────────────────────────────
function registerProcessSignalHandlers(
  app: INestApplication,
  _routeRegistry: RouteRegistryService,
  gatewayServer: http.Server,
): void {
  let shuttingDown = false;

  const performShutdown = (
    signal: NodeJS.Signals | "uncaughtException" | "unhandledRejection",
    exitCode: number,
  ): void => {
    if (shuttingDown) {
      log.warn(
        `Received '${signal}' while shutdown is already in progress — ignoring`,
      );
      return;
    }
    shuttingDown = true;

    log.info(
      `Received '${signal}' — starting graceful shutdown (timeout ${String(SHUTDOWN_GRACEFUL_TIMEOUT_MS / 1000)}s)`,
    );

    const forceExitTimer = setTimeout(() => {
      log.error(
        `Graceful shutdown exceeded ${String(SHUTDOWN_GRACEFUL_TIMEOUT_MS / 1000)}s — forcing process exit`,
      );
      process.exit(exitCode);
    }, SHUTDOWN_GRACEFUL_TIMEOUT_MS);

    if (typeof forceExitTimer.unref === "function") {
      forceExitTimer.unref();
    }

    void (async (): Promise<void> => {
      try {
        // 1. Stop accepting new traffic and let in-flight requests finish.
        //    Done BEFORE `app.close()` so a request can never be routed into a
        //    half-torn-down context.
        await drainHttpServer(gatewayServer);
        log.info("Gateway stopped accepting connections — draining complete");

        // 2. Tear down every Nest context. The orchestrator closes the sub-apps
        //    it started (setup-wizard / mesh-initializer / main-app are separate
        //    applications, each with its own server and database handles), and
        //    the database lifecycle services release the pools / SQLite handles.
        await app.close();

        clearTimeout(forceExitTimer);
        log.info("Graceful shutdown complete — exiting");
        process.exit(exitCode);
      } catch (error: unknown) {
        clearTimeout(forceExitTimer);
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Error during graceful shutdown: ${message}`);
        process.exit(exitCode === 0 ? 1 : exitCode);
      }
    })();
  };

  process.on("SIGINT", (signal) => {
    performShutdown(signal, 0);
  });

  process.on("SIGTERM", (signal) => {
    performShutdown(signal, 0);
  });

  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception — triggering graceful shutdown", { error });
    performShutdown("uncaughtException", 1);
  });

  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection — triggering graceful shutdown", {
      reason,
    });
    performShutdown("unhandledRejection", 1);
  });
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log.error(`Failed to start the application: ${message}`);
  process.exit(1);
});
