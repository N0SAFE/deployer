import "reflect-metadata";

import { logger } from "@repo/logger";

import { createSetupApp, SETUP_PORT, setupPublicUrl } from "./app.config";

/**
 * The setup app's entry point.
 *
 * Contains ONLY the parts that require a running process: bind the port and say
 * where to find it. The Nest configuration itself lives in `app.config.ts`,
 * shared with `compile.ts` — see that file for why the two must not each declare
 * their own.
 *
 * Deliberately a PLAIN Nest bootstrap — no gateway, no sub-app pipeline, no
 * fallback swapping. Those exist in `apps/api` only because that process can be
 * launched before setup has run; this process IS setup, so it needs none of it.
 *
 * The app does NOT publish a host port: it is reached exclusively through
 * Traefik on the private docker network. Binding to `0.0.0.0` inside the
 * container is required for Traefik to reach it, but no `ports:` mapping is
 * declared — publishing the pre-auth wizard on every host interface would be an
 * unnecessary attack surface.
 */
const log = logger.scope("SetupApp");

async function bootstrap(): Promise<void> {
  const app = await createSetupApp();

  await app.listen(SETUP_PORT, "0.0.0.0");

  // The URL is logged with the PUBLIC hostname, not the container port: the
  // operator needs to know where to point a browser, and the port is internal.
  log.info(`🔧 Setup app listening on :${String(SETUP_PORT)} — open http://${setupPublicUrl()}`);
  log.info("⏳ Awaiting setup — GET /setup/health reports 503 until the handover completes");
}

void bootstrap();
