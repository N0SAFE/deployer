/**
 * TraefikConfigRefresher — fire-and-forget CONFIG update for the live Traefik
 * instance, owned by the traefik CORE module.
 *
 * The operator model:
 *   - config updates → the traefik core module (this refresher + the platform
 *     config service writes the dynamic files; Traefik's file provider reloads
 *     them — no container restart needed),
 *   - process → the SupervisorOrchestratorService re-converges the Traefik
 *     supervisor (only needed when the entry port changed, the container
 *     degraded, etc. — convergeNow is a cheap no-op when healthy).
 *
 * Callers (reachability controller, deployment service, the web-app toggle,
 * boot) never await the result — a failure is logged and surfaces through the
 * supervisor health.
 */

import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";

import { TraefikPlatformConfigService } from "./traefik-platform-config.service";
import { SupervisorOrchestratorService } from "@repo/nest-supervisor-core/supervisor-orchestrator.service";
import { TraefikSupervisorService } from "../../supervisors/platform/traefik-supervisor.service";

@Injectable()
export class TraefikConfigRefresher implements OnApplicationBootstrap {
	private readonly logger = new Logger(TraefikConfigRefresher.name);

	constructor(
		private readonly configService: TraefikPlatformConfigService,
		private readonly orchestrator: SupervisorOrchestratorService,
	) {}

	/**
	 * Write the platform routes ONCE at boot.
	 *
	 * ── WHY THIS IS NEEDED ──────────────────────────────────────────────────
	 * `refresh()` was only ever called from OPERATOR ACTIONS (the web-app
	 * toggle, a deployment, a reachability re-check). Nothing wrote the platform
	 * routes on a fresh install, so `dynamic-web.yml` did not exist until an
	 * operator happened to toggle something:
	 *
	 *   $ ls /config/
	 *   dynamic-api.yml      <- written by the setup handover
	 *   dynamic-setup.yml    <- written by the setup handover
	 *
	 * The consequence was that `web.<host>` had NO router at all — not a wrong
	 * backend, no rule — so the dashboard 404'd on the ingress with nothing in
	 * the Traefik log to explain it, on every freshly onboarded node.
	 *
	 * Boot is the right moment: by the time this runs the platform has a
	 * hostname policy to publish, and the write is idempotent, so a restart
	 * simply re-publishes the same files.
	 */
	onApplicationBootstrap(): void {
		this.logger.log("Publishing platform ingress routes at boot");
		this.refresh();
	}

	/** Rewrite the instance config, then re-converge the process. Never throws. */
	refresh(): void {
		const traefikId = TraefikSupervisorService.getIdentifier();
		void (async () => {
			try {
				await this.configService.writePlatformConfigs();
			} catch (error) {
				this.logger.warn(`Traefik config write failed: ${error instanceof Error ? error.message : String(error)}`);
			}
			try {
				const state = await this.orchestrator.convergeNow(traefikId);
				if (state !== null && state === "degraded") {
					this.logger.warn(`Traefik process DEGRADED after config refresh — see supervisor health`);
				}
			} catch (error) {
				this.logger.warn(`Traefik re-converge failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		})();
	}
}