// ─── Dev-mode env var (optional) ───────────────────────────────────────────
// Docker Compose can pass SETUP_AUTO=true via environment to auto-provision
// Postgres. If not set, the app starts without a database and you can run
// the setup wizard manually via the web UI.
// This env var is NOT forced here — the user controls it via .env or docker env.

import type { INestApplication } from "@nestjs/common";
import http from "node:http";
import type express from "express";

import { logger } from "@repo/logger";
import { READINESS_PROBE, type IReadinessProbe } from "./core/readiness/readiness.port";
import {
  API_PORT,
  createApiApp,
  createGateway,
} from "./app.config";

const log = logger.scope("Api");

/**
 * Maximum time we allow NestJS to spend running `onModuleDestroy` /
 * `beforeApplicationShutdown` / `onApplicationShutdown` hooks after a
 * SIGINT/SIGTERM (or `app.close()`) before we force-exit the process.
 */
const SHUTDOWN_GRACEFUL_TIMEOUT_MS = 30_000;

// ─── Bootstrap ──────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Express server + the two probes
  // ═══════════════════════════════════════════════════════════════════════════
  // The Express instance, its CORS middleware and the Vite asset middleware are
  // built by the shared factory (see `app.config.ts`), so `compile.ts` validates
  // the same shape.
  //
  // What is added HERE is only what must answer BEFORE Nest finishes booting:
  //   1. /health        — liveness. Docker's liveness probe; never touches the DB.
  //   2. /health/ready  — readiness. THE platform gate.
  //
  // The server starts listening before Nest's `init()` so both probes answer
  // while the graph is still resolving.

  const gateway = createGateway();

  // ── Liveness — deliberately dependency-free ──────────────────────────────
  // 200 from the moment the port is bound, and it must STAY that way: in dev the
  // API starts before setup has provisioned anything, so a liveness probe that
  // needed the database would crash-loop the container and leave nothing for
  // setup to drive (plan §7.3).
  gateway.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  });

  // ── Readiness — the gate ─────────────────────────────────────────────────
  // Registered on Express rather than as a controller because it must answer
  // while Nest is still resolving the graph, and it must NOT be subject to the
  // app's auth guard: compose has no session (plan §8.2).
  //
  // The probe is resolved LAZILY from the container on each request. It cannot be
  // captured at module scope: the handler is registered before Nest exists. The
  // `strict: false` lookup returns `null` until the container is up, which is
  // itself the honest answer ("still starting") and exactly what compose must see
  // while setup runs.
  //
  // Previously this delegated to `OrchestratorService`, because the indicators
  // lived in a DIFFERENT Nest context (the main app on port 3012) that the
  // gateway could not see. There is one context now, so the port is resolved
  // directly — same contract, one fewer indirection.
  let probe: IReadinessProbe | null = null;
  gateway.get("/health/ready", (_req, res) => {
    if (probe === null) {
      res.status(503).json({
        status: "error",
        error: { probe: { reason: "application is still starting" } },
        checkedAt: new Date().toISOString(),
      });
      return;
    }
    void probe
      .probe()
      .then((result: { statusCode: number; body: unknown }) => {
        res.status(result.statusCode).json(result.body);
      })
      .catch((error: unknown) => {
        // `probe()` is documented never to throw ("a dependency is down" is a
        // 503 RESULT). If it ever does, the probe must still ANSWER rather than
        // hang the healthcheck, so the failure becomes an explicit 503.
        res.status(503).json({
          status: "error",
          error: { probe: { reason: error instanceof Error ? error.message : String(error) } },
          checkedAt: new Date().toISOString(),
        });
      });
  });

  // Start listening immediately so health checks succeed. The handle is kept
  // so shutdown can STOP ACCEPTING new connections and drain in-flight ones
  // (Nest never owns this server: we listen ourselves and hand the Express
  // instance to the adapter, so `app.close()` cannot close it).
  const gatewayServer = gateway.listen(API_PORT, "0.0.0.0");
  log.info(`🚀 API listening on port ${String(API_PORT)}`);

  // Self-test: verify health endpoint responds
  await selfTestHealthEndpoint(API_PORT);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: the Nest application
  // ═══════════════════════════════════════════════════════════════════════════
  // `createApiApp` owns the NestFactory options and the `init()` call, so
  // `compile.ts` exercises the identical construction path.
  //
  // ONE graph (`AppModule`): there is no sub-app pipeline to drive, and no
  // gateway fallback to swap — onboarding belongs to `apps/setup`.
  //
  // Express middleware order:
  //   CORS → /vite assets → /health, /health/ready → Nest → Nest 404/error

  const app = await createApiApp(gateway);

  // Resolved with `strict: false` because the token is bound inside the app
  // graph (health module) rather than in this scope; `null` means the module was
  // not registered, which the handler above reports as "still starting".
  probe = app.get<IReadinessProbe | null>(READINESS_PROBE, { strict: false });

  log.info("✅ API application initialized");

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: Signal Handlers
  // ═══════════════════════════════════════════════════════════════════════════

  registerProcessSignalHandlers(app, gatewayServer);
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
        log.info("API stopped accepting connections — draining complete");

        // 2. Tear down the Nest application. `app.close()` runs every shutdown
        //    hook, which is what releases the database pools and the SQLite
        //    handles — and, on the supervisor side, stops the convergence work.
        //
        //    It used to ALSO close the sub-apps the orchestrator had started
        //    (setup-wizard / mesh-initializer / main-app were separate
        //    applications, each with its own server and database handles, so
        //    closing the gateway did not close them). There is one graph now,
        //    so `close()` is complete on its own.
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
