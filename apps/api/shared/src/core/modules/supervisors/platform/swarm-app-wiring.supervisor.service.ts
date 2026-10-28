import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { DockerService } from "@deployer/nest-effect/docker";
import { SupervisorHost } from "@deployer/nest-effect/supervision";
import { platformNetworkName, platformOverlayForPrefix } from "@deployer/docker";
import {
	makeSwarmAppWiring,
	swarmAppWiringPayloadSchema,
	swarmAppWiringProcessInfoSchema,
	SWARM_APP_WIRING_SUPERVISOR_ID,
	type SwarmAppWiring,
} from "@deployer/platform-supervisors";
import { Effect, Fiber } from "effect";

import { EnvService } from "../../../../config/env/env.module";

export { SWARM_APP_WIRING_SUPERVISOR_ID };

/**
 * The Nest host of the swarm app-wiring supervisor. What it does (keep the API/web containers on the
 * swarm overlay, re-wiring them when they start) is `@deployer/platform-supervisors`; this class
 * supplies the engine and the environment, registers with the orchestrator, and runs the supervisor's
 * background work (start-event subscription and safety-net cadence) for the life of the module.
 */
@Injectable()
export class SwarmAppWiringSupervisorService
	extends SupervisorHost<typeof swarmAppWiringPayloadSchema, typeof swarmAppWiringProcessInfoSchema>
	implements OnModuleDestroy
{
	static readonly identifier = SWARM_APP_WIRING_SUPERVISOR_ID;

	readonly payloadSchema = swarmAppWiringPayloadSchema;
	readonly processInfoSchema = swarmAppWiringProcessInfoSchema;
	readonly description: string;

	private readonly wiring: SwarmAppWiring;
	private background: Fiber.Fiber<void> | null = null;

	constructor(
		dockerService: DockerService,
		private readonly envService: EnvService,
	) {
		super();
		this.wiring = makeSwarmAppWiring({
			engine: dockerService.getEngine(),
			logger: this.logger,
			config: {
				overlay: () => platformOverlayForPrefix(this.envService.get("DEPLOYER_PREFIX")),
				platformNetwork: () => platformNetworkName(this.envService.get("DEPLOYER_PREFIX")),
				declaredTargets: () =>
					(["DEPLOYER_API_TARGET", "DEPLOYER_WEB_TARGET"] as const)
						.map((key) => this.envService.get(key)?.trim())
						.filter((value): value is string => value !== undefined && value !== ""),
				selfHostname: () => process.env.HOSTNAME,
			},
		});
		this.description = this.wiring.spec.description;
	}

	protected buildSpec(): SwarmAppWiring["spec"] {
		return this.wiring.spec;
	}

	override onModuleInit(): void {
		super.onModuleInit();
		this.background = Effect.runFork(this.wiring.background(this.runtime.ensureDesiredState));
	}

	onModuleDestroy(): void {
		if (this.background === null) return;
		void Effect.runPromise(Fiber.interrupt(this.background));
		this.background = null;
	}
}
