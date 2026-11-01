/**
 * The mesh agent as a swarm GLOBAL service — registered ONLY when `NODE_AGENT_SWARM_MODE=true`.
 *
 * Off (the default) the node's agent is the host container setup or `NodeAgentBootstrapService` creates below
 * Swarm. On, this supervisor converges one task per node, and both launchers must skip their container: one node,
 * one owner of the run volume's socket and of the `deployer-mesh` interface.
 */
import { Logger } from "@nestjs/common";
import type { DockerEngineShape } from "@deployer/docker";
import { isNodeAgentSwarmMode } from "@deployer/node-agent-container";
import {
	makeNodeAgentSwarmSupervisor,
	NODE_AGENT_SWARM_SUPERVISOR_ID,
	nodeAgentSwarmServiceName,
	type NodeAgentSwarmSupervisor,
} from "@deployer/platform-supervisors";
import { Effect } from "effect";

import type { EnvService } from "../../../../config/env/env.module";
import { buildSupervisor, type SupervisorEventBus, type SupervisorRegistration } from "../../supervision/index";

export { NODE_AGENT_SWARM_SUPERVISOR_ID };

export type NodeAgentSwarmRegistrationDeps = {
	readonly engine: DockerEngineShape;
	readonly env: EnvService;
	readonly bus: SupervisorEventBus;
};

export function makeNodeAgentSwarmRegistration(deps: NodeAgentSwarmRegistrationDeps): {
	readonly registration: SupervisorRegistration;
	readonly agent: NodeAgentSwarmSupervisor;
} {
	const { engine, env, bus } = deps;
	const logger = new Logger("NodeAgentSwarmSupervisor");

	const agent = makeNodeAgentSwarmSupervisor({
		engine,
		logger,
		config: {
			serviceName: () => nodeAgentSwarmServiceName(env.get("DEPLOYER_PREFIX")),
			image: () => env.get("NODE_AGENT_IMAGE"),
			runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
		},
	});

	return {
		agent,
		registration: {
			supervisor: buildSupervisor(agent.spec, bus, "NodeAgentSwarmSupervisor"),
			activate: Effect.suspend(() => {
				if (!isNodeAgentSwarmMode(env.get("NODE_AGENT_SWARM_MODE"))) {
					logger.log("NODE_AGENT_SWARM_MODE is off — the node's agent stays the host container setup/the API create (supervisor not registered)");
					return Effect.succeed(null);
				}
				logger.log("NODE_AGENT_SWARM_MODE=true — the swarm owns this node's mesh agent; the host container will not be created");
				return Effect.succeed({});
			}),
		},
	};
}
