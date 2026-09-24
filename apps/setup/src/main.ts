import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { logger } from "@repo/logger";

import { SetupAppModule } from "./app.module";

/**
 * The setup app's bootstrap.
 *
 * Deliberately a PLAIN Nest bootstrap — no gateway, no sub-app pipeline, no
 * fallback swapping. Those exist in `apps/api` only because that process can be
 * launched before setup has run; this process IS setup, so it needs none of it.
 *
 * The app does NOT publish a host port: it is reached exclusively through
 * Traefik on the private docker network (`setup.deployer.localhost`). Binding
 * to `0.0.0.0` inside the container is required for Traefik to reach it, but no
 * `ports:` mapping is declared — publishing the pre-auth wizard on every host
 * interface would be an unnecessary attack surface.
 */
const SETUP_PORT = Number(process.env.SETUP_APP_PORT ?? 3016);

const log = logger.scope("SetupApp");

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(SetupAppModule, {
    snapshot: process.env.NODE_ENV !== "production",
  });

  app.enableShutdownHooks();

  await app.listen(SETUP_PORT, "0.0.0.0");

  // The URL is logged with the PUBLIC hostname, not the container port: the
  // operator needs to know where to point a browser, and the port is internal.
  const prefix = process.env.DEPLOYER_PREFIX ?? "";
  const host = prefix === "" ? "setup.deployer.localhost" : `setup.${prefix}deployer.localhost`;
  log.info(`🔧 Setup app listening on :${String(SETUP_PORT)} — open http://${host}`);
  log.info("⏳ Awaiting setup — GET /setup/health reports 503 until the handover completes");
}

void bootstrap();
