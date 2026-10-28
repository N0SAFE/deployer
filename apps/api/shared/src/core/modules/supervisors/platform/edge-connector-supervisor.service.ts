import { Injectable } from "@nestjs/common";
import { DockerService } from "@deployer/nest-effect/docker";
import { SupervisorHost } from "@deployer/nest-effect/supervision";
import {
	EDGE_CONNECTOR_SUPERVISOR_ID,
	edgeConnectorProcessInfoSchema,
	edgeConnectorSupervisorPayloadSchema,
	makeEdgeConnectorSupervisor,
	type EdgeConnectorSupervisor,
} from "@deployer/platform-supervisors";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { Effect } from "effect";

import { EnvService } from "../../../../config/env/env.module";
import { IngressLanesService } from "../../platform-ingress/services/ingress-lanes.service";
import { PublicEdgeService } from "../../reachability/services/public-edge.service";

export { EDGE_CONNECTOR_SUPERVISOR_ID };

/**
 * The Nest host of the public edge's connector supervisor. What it does (run the provider's outbound
 * tunnel connector as a replicated swarm service, remove it when the edge changes) is
 * `@deployer/platform-supervisors`; this class supplies the engine, the environment and the edge
 * provider's answer, and primes that answer before registering so a running edge does not read as
 * absent on the first probe.
 */
@Injectable()
export class EdgeConnectorSupervisorService extends SupervisorHost<
	typeof edgeConnectorSupervisorPayloadSchema,
	typeof edgeConnectorProcessInfoSchema
> {
	static readonly identifier = EDGE_CONNECTOR_SUPERVISOR_ID;

	readonly payloadSchema = edgeConnectorSupervisorPayloadSchema;
	readonly processInfoSchema = edgeConnectorProcessInfoSchema;
	readonly description: string;

	private readonly edgeConnector: EdgeConnectorSupervisor;

	constructor(
		dockerService: DockerService,
		env: EnvService,
		lanes: IngressLanesService,
		private readonly edge: PublicEdgeService,
	) {
		super();
		this.edgeConnector = makeEdgeConnectorSupervisor({
			engine: dockerService.getEngine(),
			logger: this.logger,
			config: {
				prefix: () => env.get("DEPLOYER_PREFIX"),
				desired: Effect.tryPromise(async () => await edge.connector(await lanes.getLanes())),
				routeTarget: () => edge.ingressTarget(),
				runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
			},
		});
		this.description = this.edgeConnector.spec.description;
	}

	protected buildSpec(): EdgeConnectorSupervisor["spec"] {
		return this.edgeConnector.spec;
	}

	override onModuleInit(): void {
		void runPromiseUnwrapped(this.edgeConnector.reload)
			.catch((error: unknown) => {
				this.logger.warn(`Edge connector not resolved at boot: ${error instanceof Error ? error.message : String(error)}`);
			})
			.then(() => {
				this.logger.log(`Edge connector supervisor registering — runtime=${this.edgeConnector.runtime()}`);
				super.onModuleInit();
			});
	}
}
