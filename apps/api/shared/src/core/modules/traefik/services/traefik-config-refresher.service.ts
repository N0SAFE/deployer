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

import { Logger } from "@nestjs/common";
import { Context } from "effect";

import { runPromiseUnwrapped } from "@deployer/effect-core";
import { type SupervisorOrchestratorShape } from "@deployer/supervision";

import { EDGE_CONNECTOR_SUPERVISOR_ID } from "../../supervisors/platform/edge-connector.supervisor";
import { PLATFORM_INGRESS_SUPERVISOR_ID } from "../../supervisors/platform/traefik.supervisor";

export type TraefikConfigRefresherShape = {
	/** Re-converge the ingress and the edge connector. Never throws. */
	readonly refresh: () => void;
};

export function makeTraefikConfigRefresher(orchestrator: SupervisorOrchestratorShape): TraefikConfigRefresherShape {
	const logger = new Logger("TraefikConfigRefresher");
	return {
		refresh() {
			void (async () => {
				for (const id of [PLATFORM_INGRESS_SUPERVISOR_ID, EDGE_CONNECTOR_SUPERVISOR_ID]) {
					try {
						const state = await runPromiseUnwrapped(orchestrator.convergeNow(id));
						if (state === "degraded") logger.warn(`${id} DEGRADED after an ingress refresh — see supervisor health`);
					} catch (error) {
						logger.warn(`${id} re-converge failed: ${error instanceof Error ? error.message : String(error)}`);
					}
				}
			})();
		},
	};
}

export class TraefikConfigRefresher extends Context.Service<TraefikConfigRefresher, TraefikConfigRefresherShape>()(
	"shared/TraefikConfigRefresher",
) {}
