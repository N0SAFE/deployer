import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "./app.module";
import { apiReference } from "@scalar/nestjs-api-reference";
import { generateSpec } from "./openapi";
import { AuthService } from "./core/modules/auth/services/auth.service";
import { isErrorResult, merge } from "openapi-merge";
import type {Express} from 'express';
import { buildAllowedOrigins, normalizeUrl, isLocalhostOrigin } from "./core/utils/cors.utils";
import { logger } from "@repo/logger";
import { APIErrorExceptionFilter } from "./core/modules/auth/filters/api-error-exception-filter";
import { InternalErrorExceptionFilter } from "./core/middlewares/internal-error/internal-error-exception.filter";
import { oc } from "@orpc/contract";
import { os } from "@orpc/server";
import { z } from "zod/v4";

/**
 * Maximum time we allow NestJS to spend running `onModuleDestroy` /
 * `beforeApplicationShutdown` / `onApplicationShutdown` hooks after a
 * SIGINT/SIGTERM (or `app.close()`) before we force-exit the process.
 *
 * Each registered `OnModuleDestroy` / `OnApplicationShutdown` is responsible
 * for stopping its own resources (scanner containers, mesh connections,
 * terminal sessions, timers, etc.). The timeout below is a safety net so
 * the process never hangs forever during teardown — e.g. a stuck Docker
 * call inside `ScannerContainerManagerService.stopContainer()` must not
 * block the container stop signal from reaching the orchestrator.
 */
const SHUTDOWN_GRACEFUL_TIMEOUT_MS = 30_000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    snapshot: process.env.NODE_ENV !== "production",
    bodyParser: false, // Disable NestJS body parser for oRPC
  });

  // Listen to process signals (SIGINT / SIGTERM) and trigger NestJS
  // shutdown hooks (onModuleDestroy → beforeApplicationShutdown →
  // onApplicationShutdown) instead of dying abruptly and leaving
  // scanner containers, mesh connections, timers, etc. dangling.
  app.enableShutdownHooks();

  const authService = await app.resolve<AuthService>(AuthService);

  // Build list of allowed origins for CORS
  const allowedOrigins = buildAllowedOrigins(process.env as Record<string, string | undefined>);

  // Enable CORS with flexible origin matching
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (e.g., mobile apps, Postman, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }
      
      // Normalize the incoming origin
      const normalizedOrigin = normalizeUrl(origin);
      
      // Check if origin is in allowed list
      if (allowedOrigins.includes(normalizedOrigin)) {
        callback(null, true);
        return;
      }
      
      // In development, be more permissive with localhost
      if (process.env.NODE_ENV !== 'production' && isLocalhostOrigin(normalizedOrigin)) {
        callback(null, true);
        return;
      }
      
      // Reject the origin
      logger.warn(`CORS: Rejected origin: ${origin}`);
      logger.warn(`CORS: Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Set-Cookie'],
  });

  app.useLogger(["log", "error", "warn", "debug", "verbose"]);
  app.useGlobalFilters(
    app.get(APIErrorExceptionFilter),
    app.get(InternalErrorExceptionFilter),
  );

  // Serve OpenAPI JSON generated from the oRPC app contract
  const http = app.getHttpAdapter().getInstance() as Express
   
  http.get("/openapi.json", async (_req, res) => {
    try {
      const mergeResult = merge([
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        { oas: (await generateSpec()) as any },
        {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          oas: (await authService.generateAuthOpenAPISchema()) as any,
          pathModification: { prepend: "/api/auth" },
        },
      ]);

      if (isErrorResult(mergeResult)) {
        throw new Error(
          `Failed to merge OpenAPI specs: ${mergeResult.message} (${mergeResult.type})}`
        );
      }

      const spec = mergeResult.output;

      res.setHeader("Content-Type", "application/json");
      res.status(200).send(JSON.stringify(spec));
    } catch (err) {
      // Avoid leaking details in production
      const message =
        err instanceof Error ? err.message : "Failed to generate OpenAPI spec";
      res.status(500).send({ error: message });
    }
  });

  // Serve Scalar API Reference UI
  app.use(
    "/reference",
    apiReference({
      // Use the OpenAPI endpoint served above
      url: "/openapi.json",
      // Pick a readable theme; adjust as preferred
      // theme: 'purple',
    })
  );

  const port = process.env.API_PORT ?? 3005;
  await app.listen(port);
  logger.info(`🚀 NestJS API with oRPC running on port ${String(port)}`);
  logger.info(
    `📘 OpenAPI JSON available at http://localhost:${String(port)}/openapi.json`
  );
  logger.info(`📗 Scalar API Reference at http://localhost:${String(port)}/reference`);

  registerProcessSignalHandlers(app);
}

/**
 * Wire up SIGINT / SIGTERM / uncaughtException / unhandledRejection
 * handlers so the API process always exits through `app.close()` —
 * which in turn runs every `OnModuleDestroy` and
 * `OnApplicationShutdown` hook — rather than dying abruptly and
 * leaving behind scanner containers, mesh sessions, timers, etc.
 */
function registerProcessSignalHandlers(app: INestApplication): void {
  let shuttingDown = false;

  const performShutdown = (signal: NodeJS.Signals | "uncaughtException" | "unhandledRejection", exitCode: number): void => {
    if (shuttingDown) {
      logger.warn(`Received '${signal}' while shutdown is already in progress — ignoring`);
      return;
    }
    shuttingDown = true;

    logger.info(`Received '${signal}' — starting graceful shutdown (timeout ${String(SHUTDOWN_GRACEFUL_TIMEOUT_MS / 1000)}s)`);

    // Force-exit safety net: if NestJS teardown hangs (e.g. a stuck
    // Docker call inside ScannerContainerManagerService.stopContainer()),
    // make sure the process still terminates so the orchestrator can
    // mark it as stopped.
    const forceExitTimer = setTimeout(() => {
      logger.error(
        `Graceful shutdown exceeded ${String(SHUTDOWN_GRACEFUL_TIMEOUT_MS / 1000)}s — forcing process exit`,
      );
      process.exit(exitCode);
    }, SHUTDOWN_GRACEFUL_TIMEOUT_MS);

    // Don't keep the process alive purely for the safety-net timer.
    if (typeof forceExitTimer.unref === "function") {
      forceExitTimer.unref();
    }

    void app
      .close()
      .then(() => {
        clearTimeout(forceExitTimer);
        logger.info("Graceful shutdown complete — exiting");
        process.exit(exitCode);
      })
      .catch((error: unknown) => {
        clearTimeout(forceExitTimer);
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Error during graceful shutdown: ${message}`);
        process.exit(exitCode === 0 ? 1 : exitCode);
      });
  };

  process.on("SIGINT", (signal) => {
    performShutdown(signal, 0);
  });

  process.on("SIGTERM", (signal) => {
    performShutdown(signal, 0);
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception — triggering graceful shutdown", { error });
    performShutdown("uncaughtException", 1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection — triggering graceful shutdown", { reason });
    performShutdown("unhandledRejection", 1);
  });
}

bootstrap().catch((error: unknown) => {
  logger.error("Failed to start the application", { error });
  process.exit(1);
});
