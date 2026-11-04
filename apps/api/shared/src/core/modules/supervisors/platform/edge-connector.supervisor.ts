import { Logger } from "@nestjs/common";
import { Effect } from "effect";

import type { DockerEngineShape } from "@deployer/docker";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import {
	EDGE_CONNECTOR_SUPERVISOR_ID,
	
	
	makeEdgeConnectorSupervisor,
	
} from "@deployer/platform-supervisors";

import { EnvService } from "../../../../config/env/env.module";
import { IngressLanesService } from "../../platform-ingress/services/ingress-lanes.service";
import type { PublicEdgeServiceShape } from "../../reachability/services/public-edge.service";
import { buildSupervisor, type SupervisorEventBus, type SupervisorRegistration } from "../../supervision/index";

export { EDGE_CONNECTOR_SUPERVISOR_ID };

export type EdgeConnectorSupervisorDeps = {
	readonly engine: DockerEngineShape;
	readonly env: EnvService;
	readonly lanes: IngressLanesService;
	readonly edge: PublicEdgeServiceShape;
	readonly bus: SupervisorEventBus;
};

/**
 * The supervisor of the public edge's connector. It registers once the connector has been resolved from
 * the provider (the first `reload`); boot does not wait for that, since a slow provider must not hold
 * the app back.
 */
export function makeEdgeConnectorRegistration({ engine, env, lanes, edge, bus }: EdgeConnectorSupervisorDeps): SupervisorRegistration {
	const logger = new Logger("EdgeConnectorSupervisor");
	const edgeConnector = makeEdgeConnectorSupervisor({
		engine,
		logger,
		config: {
			prefix: () => env.get("DEPLOYER_PREFIX"),
			desired: Effect.tryPromise(() => lanes.getLanes()).pipe(Effect.flatMap((current) => edge.connector(current))),
			routeTarget: () => edge.ingressTarget(),
			runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
		},
	});
	return {
		supervisor: buildSupervisor(edgeConnector.spec, bus, "EdgeConnectorSupervisor"),
		blocking: false,
		activate: edgeConnector.reload.pipe(
			Effect.catch((error: unknown) =>
				Effect.sync(() => {
					logger.warn(`Edge connector not resolved at boot: ${error instanceof Error ? error.message : String(error)}`);
				}),
			),
			Effect.map(() => {
				logger.log(`Edge connector supervisor registering — runtime=${edgeConnector.runtime()}`);
				return {};
			}),
		),
	};
}
