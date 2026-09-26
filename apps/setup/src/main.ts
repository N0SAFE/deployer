import "reflect-metadata";

import { logger } from "@repo/logger";

import { createSetupApp, SETUP_PORT, setupPublicUrl } from "./app.config";
import { SetupExitService } from "./modules/handover/services/setup-exit.service";

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

  // ── One-way: run until the handover completes, then stop. ──────────────────
  //
  // Setup is not a server that stays up; it hands the platform over and leaves
  // (plan §1). The service owns WHEN that happens (phase `ready`, after a grace
  // period for the Traefik reload), and this is the MECHANISM: close Nest — which
  // runs every shutdown hook, so supervisors and connections are released — then
  // exit 0.
  //
  // A FAILED setup never resolves this promise, on purpose: the container must
  // keep serving the wizard so the operator can fix the cause and retry. An
  // exit here would leave the platform unreachable with no surface to recover
  // from, and the compose healthcheck would never turn green (§10.4).
  await app.get(SetupExitService).waitForExit();

  log.info("✅ Handover complete — shutting down the setup app");
  await app.close();
  process.exit(0);
}

void bootstrap();
