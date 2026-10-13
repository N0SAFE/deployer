/**
 * MeshAgentBootstrapService — make sure the node the API runs on has its agent.
 *
 * Setup starts the agent on a fresh install. This covers the other case: a node
 * installed before the mesh existed, or whose agent container was removed. It
 * runs once at boot, best-effort — the API never fails to start over it, because
 * every consumer of the agent already degrades to "local only" without one.
 *
 * It founds the mesh ONLY for a lone node: on a node that already shares a swarm
 * with others, founding would create a second, unrelated mesh. Those nodes join
 * the mesh through an admission instead, and the log says so.
 *
 * Once the node is in a cluster it publishes its platform node id as a member
 * label (`deployer.node-id`), so the Network pages can tell which mesh member is
 * which node. Labels merge, so this never clobbers another fact.
 */

import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { dockerodeAgentEngine, ensureMeshAgentContainer, MEMBER_LABEL_NODE_ID, meshAgentContainerEnv, type AgentStatus } from "@deployer/mesh-network";
import { DockerService } from "@deployer/nest-docker/services/docker.service";
import { NodeConfigRepository } from "@deployer/nest-nodes/node-config.repository";

import { EnvService } from "@/config/env/env.module";
import { MeshAgentClient } from "@/core/modules/mesh-agent/mesh-agent.client";

@Injectable()
export class MeshAgentBootstrapService implements OnApplicationBootstrap {
	private readonly logger = new Logger(MeshAgentBootstrapService.name);

	constructor(
		private readonly mesh: MeshAgentClient,
		private readonly docker: DockerService,
		private readonly env: EnvService,
		private readonly nodeConfig: NodeConfigRepository,
	) {}

	onApplicationBootstrap(): void {
		void this.ensure().catch((error: unknown) => {
			this.logger.warn(`Mesh agent not ensured: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	async ensure(): Promise<void> {
		const node = this.nodeConfig.find();
		if (node?.setupState !== "setup_done") return;

		const outcome = await ensureMeshAgentContainer(dockerodeAgentEngine(this.docker.getDockerClient()), {
			image: this.env.get("MESH_AGENT_IMAGE"),
			env: meshAgentContainerEnv({ dataplane: this.env.get("MESH_AGENT_DATAPLANE") }),
		});
		if (outcome !== "running") this.logger.log(`Mesh agent ${outcome} on this node`);

		const status = await this.mesh.status().catch(() => null);
		if (status === null) {
			this.logger.warn(`Mesh agent started but its socket is not visible at ${this.mesh.socketPath()} — is the run volume mounted into the API?`);
			return;
		}
		if (status.cluster !== null) {
			await this.publishNodeId(status, node.nodeId);
			return;
		}

		const nodes = await this.docker.listSwarmNodes().catch(() => []);
		if (nodes.length > 1) {
			this.logger.warn(
				`This node shares a ${String(nodes.length)}-node swarm but is in no mesh — founding one here would split the cluster. Re-run the join flow on this node so a member admits it (see "Upgrading an existing cluster" in docs/edge-mesh-architecture.md)`,
			);
			return;
		}
		const founded = await this.mesh.ensureCluster({ labels: { [MEMBER_LABEL_NODE_ID]: node.nodeId } });
		this.logger.log(`Founded the mesh ${founded.cluster?.clusterId ?? "?"} — this node is ${founded.cluster?.address ?? "?"}`);
	}

	/** Label this node's member with its platform node id, when it is not already. */
	private async publishNodeId(status: AgentStatus, nodeId: string): Promise<void> {
		const self = status.members.find((member) => member.memberId === status.memberId);
		if (self?.labels[MEMBER_LABEL_NODE_ID] === nodeId) return;
		await this.mesh.setLabels({ [MEMBER_LABEL_NODE_ID]: nodeId });
		this.logger.log(`Mesh member labelled with node id ${nodeId}`);
	}
}
