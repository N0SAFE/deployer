import { Injectable, Logger } from "@nestjs/common";
import {
  AGENT_SOCKET_PATH,
  dockerodeAgentEngine,
  ensureMeshAgentContainer,
  MeshAgentHttpClient,
  meshAgentContainerEnv,
  type AgentStatus,
  type DockerodeLike,
} from "@deployer/mesh-network";
import { DockerService } from "@deployer/nest-docker/services/docker.service";

import { EnvService } from "@/config/env/env.module";

/**
 * Starts this node's mesh agent before anything else touches the cluster.
 *
 * ── WHY SETUP, AND WHY FIRST ───────────────────────────────────────────────
 * The mesh is BELOW Swarm: Swarm advertises, listens and carries its overlay
 * traffic on the node's mesh address, and that address only exists once the
 * agent has created the WireGuard interface. Setup is the first process on a
 * fresh node, so it is the one that has to start the agent — the API does not
 * exist yet.
 *
 * Founding the mesh happens only on the `found` path. A node that joins enters
 * the mesh through an admission from a member (the API's remote join), never by
 * founding one of its own.
 */
@Injectable()
export class MeshAgentLauncherService {
  private readonly logger = new Logger(MeshAgentLauncherService.name);
  private static readonly INTERFACE_WAIT_MS = 20_000;

  constructor(
    private readonly docker: DockerService,
    private readonly env: EnvService,
  ) {}

  private client(): MeshAgentHttpClient {
    return new MeshAgentHttpClient(this.env.get("MESH_AGENT_SOCKET") ?? AGENT_SOCKET_PATH);
  }

  /** Ensure the agent container runs and answers on its socket. */
  async ensureRunning(): Promise<AgentStatus> {
    const outcome = await ensureMeshAgentContainer(
      dockerodeAgentEngine(this.docker.getDockerClient()),
      { image: this.env.get("MESH_AGENT_IMAGE"), env: meshAgentContainerEnv({ dataplane: this.env.get("MESH_AGENT_DATAPLANE") }) },
    );
    if (outcome !== "running") this.logger.log(`Mesh agent ${outcome}`);
    return await this.client().waitUntilReachable();
  }

  /**
   * Found the mesh (idempotently) and return this node's mesh address once the
   * kernel interface carries it — or null when it does not come up (no WireGuard
   * module, no NET_ADMIN), in which case Swarm binds loopback and the node runs
   * alone until the mesh is fixed.
   */
  async foundAndResolveAddress(): Promise<string | null> {
    await this.ensureRunning();
    const founded = await this.client().ensureCluster({});
    this.logger.log(`Mesh ${founded.cluster?.clusterId ?? "?"} — this node is ${founded.cluster?.address ?? "?"}`);
    return await this.meshAddress(MeshAgentLauncherService.INTERFACE_WAIT_MS);
  }

  /** This node's mesh address once its interface is up, waiting up to `waitMs`. */
  async meshAddress(waitMs = 0): Promise<string | null> {
    const deadline = Date.now() + waitMs;
    do {
      const status = await this.client().status().catch(() => null);
      if (status?.cluster?.interfaceUp === true) return status.cluster.address;
      if (status?.lastError !== null && status?.lastError !== undefined) {
        this.logger.warn(`Mesh interface not up yet: ${status.lastError}`);
      }
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    } while (Date.now() < deadline);
    return null;
  }
}
