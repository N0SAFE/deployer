/**
 * NodeAgentBootstrapService — make sure the node the API runs on has its agent.
 *
 * Setup starts the agent on a fresh install. This covers the other case: a node
 * installed before the mesh existed, or whose agent container was removed. It
 * runs once at boot, best-effort — the API never fails to start over it, because
 * every consumer of the agent already degrades to "local only" without one.
 *
 * Once the node is in a cluster it publishes its platform node id as a member
 * label (`deployer.node-id`), so the Network pages can tell which mesh member is
 * which node. Labels merge, so this never clobbers another fact.
 */

import { Injectable, Logger, type OnApplicationBootstrap, Inject } from "@nestjs/common";
import { Effect } from "effect";

import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { NODE_DOOR_SOCKET_ENV, NODE_ID_LABEL, nodeDoorFromEnv } from "@deployer/mesh-client";
import { ensureNodeAgentContainer, isNodeAgentSwarmMode, makeNodeAgentEngine } from "@deployer/node-agent-container";
import { NodeConfigRepository, type NodeConfigRepositoryShape } from "@deployer/node-state"

import { EnvService } from "../../../config/env/env.module";

@Injectable()
export class NodeAgentBootstrapService implements OnApplicationBootstrap {
	private readonly logger = new Logger(NodeAgentBootstrapService.name);

	constructor(
		@Inject(DockerEngine) private readonly docker: DockerEngineShape,
		private readonly env: EnvService,
		@Inject(NodeConfigRepository) private readonly nodeConfig: NodeConfigRepositoryShape,
	) {}

	onApplicationBootstrap(): void {
		void this.ensure().catch((error: unknown) => {
			this.logger.warn(`Mesh agent not ensured: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	async ensure(): Promise<void> {
		const node = await runPromiseUnwrapped(this.nodeConfig.find());
		if (node?.setupState !== "setup_done") return;

		// NODE_AGENT_SWARM_MODE=true: the swarm runs the agent as a GLOBAL service. Creating the host container too
		// would give the socket and the `deployer-mesh` interface a second owner, so only the door is read here.
		if (isNodeAgentSwarmMode(this.env.get("NODE_AGENT_SWARM_MODE"))) {
			this.warnSwarmModeOnce();
		} else {
			const image = this.env.get("NODE_AGENT_IMAGE");
			if (image === undefined || image === "") {
				this.logger.warn("No mesh agent image: set NODE_AGENT_IMAGE");
				return;
			}

			const outcome = await ensureNodeAgentContainer(makeNodeAgentEngine(this.docker), { image });
			if (outcome !== "running") this.logger.log(`Mesh agent ${outcome} on this node`);
		}

		const status = await nodeDoorFromEnv(this.env).status();
		if (status === null) {
			this.logger.warn(`Mesh agent started but its node door is not visible at ${this.env.get(NODE_DOOR_SOCKET_ENV) ?? "(unset NODE_AGENT_SOCKET)"} — is the run volume mounted into the API?`);
			return;
		}
		this.logger.log(`Mesh agent answered: ${status.agentId} — interface ${status.interfaceUp ? "up" : "down"}`);

		// A lone node founds its own mesh; on a multi-node swarm a down interface means the node cannot reach its peers,
		// which is an operator problem, not something this process can fix by founding a second network.
		if (!status.interfaceUp) {
			const nodes = await runPromiseUnwrapped(this.docker.swarmNodes.list().pipe(Effect.orElseSucceed(() => [])));
			if (nodes.length > 1) {
				this.logger.warn(
					`This node shares a ${String(nodes.length)}-node swarm but its mesh interface is down — check its agent (see "Upgrading an existing cluster" in docs/edge-mesh-architecture.md)`,
				);
			}
		}

		await this.labelNode(node.nodeId);
	}

	private warnedSwarmMode = false;

	/** Says once why no container is created: this runs at boot, and a repeated line would only be noise. */
	private warnSwarmModeOnce(): void {
		if (this.warnedSwarmMode) return;
		this.warnedSwarmMode = true;
		this.logger.log("NODE_AGENT_SWARM_MODE=true — the swarm owns this node's mesh agent; not creating the host container");
	}

	/** Labels this node's roster entry with its platform node id, through the node door. Best-effort: labels are cosmetic. */
	private async labelNode(nodeId: string): Promise<void> {
		const labelled = await nodeDoorFromEnv(this.env).labels({ [NODE_ID_LABEL]: nodeId });
		if (labelled === null) {
			this.logger.warn("Mesh agent label write failed: the node door did not answer");
			return;
		}
		this.logger.log(`Mesh member labelled with node id ${nodeId}`);
	}
}
