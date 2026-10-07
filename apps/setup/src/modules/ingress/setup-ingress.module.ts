import { Module } from "@nestjs/common";

import { EnvModule } from "@/config/env/env.module";
import { BootstrapIngressService } from "./services/bootstrap-ingress.service";

/**
 * The INGRESS half of setup: the bootstrap Traefik that makes this app
 * reachable before the platform exists.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 * This app publishes no ports and is reachable ONLY through Traefik. The API
 * normally supervises Traefik, but the API starts only after setup's gate opens
 * — and the gate opens only when an operator completes the wizard in a browser.
 * Without a bootstrap ingress, nothing can reach the wizard, so the gate never
 * opens and the API never starts. See `BootstrapIngressService` for the full
 * cycle.
 *
 * ── WHY IT IMPORTS NOTHING BUT `EnvModule` ──────────────────────────────────
 * `DockerModule` is `@Global()` (registered by `SetupClusterModule` with this
 * app's engine configuration), so `DockerService` resolves without a second
 * wiring of the same client — the same reason `HandoverModule` does not import
 * it either.
 *
 * This module is deliberately independent of the cluster and the gate: the
 * ingress must exist BEFORE the cluster is founded, and it must be removed
 * during the handover that happens AFTER the gate opens. Depending on either
 * would put it on the wrong side of the boundary it exists to bridge.
 */
@Module({
  imports: [EnvModule],
  providers: [BootstrapIngressService],
  // The handover releases the entry port, so it needs this service. Exporting
  // rather than redeclaring keeps ONE owner of the ingress process.
  exports: [BootstrapIngressService],
})
export class SetupIngressModule {}
