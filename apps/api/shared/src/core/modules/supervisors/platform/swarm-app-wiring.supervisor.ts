import { Logger } from "@nestjs/common";
import type { DockerEngineShape } from "@deployer/docker";
import { buildSupervisor, type SupervisorEventBus, type SupervisorRegistration } from "../../supervision/index";
import { platformNetworkName, platformOverlayForPrefix } from "@deployer/docker";
import {
	makeSwarmAppWiring,
	swarmAppWiringPayloadSchema,
	swarmAppWiringProcessInfoSchema,
	SWARM_APP_WIRING_SUPERVISOR_ID,
	type SwarmAppWiring,
} from "@deployer/platform-supervisors";
import { Effect } from "effect";

import { EnvService } from "../../../../config/env/env.module";

export { SWARM_APP_WIRING_SUPERVISOR_ID };

export type SwarmAppWiringDeps = {
	readonly engine: DockerEngineShape;
	readonly env: EnvService;
	readonly bus: SupervisorEventBus;
};

/**
 * The supervisor that keeps this API container attached to the swarm overlay. Always registered; its
 * background loop re-wires when the overlay appears or changes.
 */
export function makeSwarmAppWiringRegistration({ engine, env, bus }: SwarmAppWiringDeps): SupervisorRegistration {
	const wiring = makeSwarmAppWiring({
		engine,
		logger: new Logger("SwarmAppWiringSupervisor"),
		config: {
			overlay: () => platformOverlayForPrefix(env.get("DEPLOYER_PREFIX")),
			platformNetwork: () => platformNetworkName(env.get("DEPLOYER_PREFIX")),
			declaredTargets: () =>
				(["DEPLOYER_API_TARGET", "DEPLOYER_WEB_TARGET"] as const)
					.map((key) => env.get(key)?.trim())
					.filter((value): value is string => value !== undefined && value !== ""),
			selfHostname: () => process.env.HOSTNAME,
		},
	});
	const supervisor = buildSupervisor(wiring.spec, bus, "SwarmAppWiringSupervisor");
	return { supervisor, activate: Effect.succeed({ background: wiring.background(supervisor.ensureDesiredState) }) };
}
