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
 * Callers (reachability controller, deployment service, boot) never await the
 * result — a failure is logged and surfaces through the supervisor health.
 */

import { Injectable, Logger } from "@nestjs/common";

import { TraefikPlatformConfigService } from "./traefik-platform-config.service";
import { SupervisorOrchestratorService } from "../../supervisors/supervisor-orchestrator.service";
import { TraefikSupervisorService } from "../../supervisors/platform/traefik-supervisor.service";

@Injectable()
export class TraefikConfigRefresher {
	private readonly logger = new Logger(TraefikConfigRefresher.name);

	constructor(
		private readonly configService: TraefikPlatformConfigService,
		private readonly orchestrator: SupervisorOrchestratorService,
	) {}

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