/**
 * TraefikConfigRefresher — "apply it now" after an operator action.
 *
 * ROUTES need no push at all any more: every ingress task polls them from the API
 * (`TraefikIngressConfigService`, every few seconds), so a deployment or a domain
 * change is live on the next poll with nothing written anywhere. What an operator
 * action CAN change is the ingress PROCESS — a lane switch adds or removes the
 * `direct` host ports, the TLS entrypoint, the connectors and the node doors — and
 * the supervisors only notice that on their next sweep. This re-converges them
 * immediately instead.
 *
 * Fire-and-forget: callers (reachability, deployments, the web-app toggle) never
 * await it; a failure is logged and surfaces through supervisor health.
 */

import { Injectable, Logger } from "@nestjs/common";
import { SupervisorOrchestratorService } from "@deployer/nest-supervisor-core/supervisor-orchestrator.service";

import { EdgeConnectorSupervisorService } from "@/core/modules/supervisors/platform/edge-connector-supervisor.service";
import { TraefikSupervisorService } from "@/core/modules/supervisors/platform/traefik-supervisor.service";

@Injectable()
export class TraefikConfigRefresher {
	private readonly logger = new Logger(TraefikConfigRefresher.name);

	constructor(private readonly orchestrator: SupervisorOrchestratorService) {}

	/** Re-converge the ingress and the edge connector. Never throws. */
	refresh(): void {
		void (async () => {
			for (const id of [TraefikSupervisorService.getIdentifier(), EdgeConnectorSupervisorService.getIdentifier()]) {
				try {
					const state = await this.orchestrator.convergeNow(id);
					if (state === "degraded") this.logger.warn(`${id} DEGRADED after an ingress refresh — see supervisor health`);
				} catch (error) {
					this.logger.warn(`${id} re-converge failed: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		})();
	}
}
