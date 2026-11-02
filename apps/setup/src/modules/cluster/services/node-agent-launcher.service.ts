import { Injectable, Logger, Inject } from "@nestjs/common";

import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { nodeDoorFromEnv, type NodeDoorClient, type NodeDoorStatus } from "@deployer/mesh-client";
import { ensureNodeAgentContainer, isNodeAgentSwarmMode, makeNodeAgentEngine } from "@deployer/node-agent-container";

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
 * The agent founds its mesh itself and a node that joins enters it by redeeming
 * a join token (the API's remote join); setup never coordinates that handshake.
 */
@Injectable()
export class NodeAgentLauncherService {
  private readonly logger = new Logger(NodeAgentLauncherService.name);
  private static readonly INTERFACE_WAIT_MS = 20_000;
  /** One line explains why no container is created; this runs on every bootstrap pass. */
  private warnedSwarmMode = false;

  constructor(
    @Inject(DockerEngine) private readonly docker: DockerEngineShape,
    private readonly env: EnvService,
  ) {}

  /** The agent's node door, on the socket the deployment binds. */
  private door(): NodeDoorClient {
    return nodeDoorFromEnv(this.env);
  }

  /** Ensure the agent container runs and its node door answers. */
  async ensureRunning(): Promise<NodeDoorStatus | null> {
    // The swarm service owns this node's agent (NODE_AGENT_SWARM_MODE=true): creating the host container as well
    // would give the socket and the `deployer-mesh` interface a second owner. Wait for the task's door instead.
    if (isNodeAgentSwarmMode(this.env.get("NODE_AGENT_SWARM_MODE"))) {
      this.warnSwarmModeOnce();
      return await this.status(NodeAgentLauncherService.INTERFACE_WAIT_MS);
    }
    const image = this.env.get("NODE_AGENT_IMAGE");
    if (image === undefined || image === "") {
      this.logger.warn("No mesh agent image: set NODE_AGENT_IMAGE");
      return null;
    }
    const outcome = await ensureNodeAgentContainer(makeNodeAgentEngine(this.docker), { image });
    if (outcome !== "running") this.logger.log(`Mesh agent ${outcome}`);
    const status = await this.status(NodeAgentLauncherService.INTERFACE_WAIT_MS);
    if (status === null) this.logger.warn("Mesh agent started but its node door does not answer yet");
    return status;
  }

  private warnSwarmModeOnce(): void {
    if (this.warnedSwarmMode) return;
    this.warnedSwarmMode = true;
    this.logger.log(
      "NODE_AGENT_SWARM_MODE=true — the swarm owns this node's mesh agent; not creating the host container",
    );
  }

  /**
   * Start the agent and return this node's mesh address once the kernel
   * interface carries it — or null when it does not come up (no WireGuard
   * module, no NET_ADMIN), in which case Swarm binds a real interface address
   * and the node runs alone until the mesh is fixed.
   */
  async foundAndResolveAddress(): Promise<string | null> {
    await this.ensureRunning();
    return await this.meshAddress(NodeAgentLauncherService.INTERFACE_WAIT_MS);
  }

  /** This node's mesh address once its interface is up, waiting up to `waitMs`. */
  async meshAddress(waitMs = 0): Promise<string | null> {
    const deadline = Date.now() + waitMs;
    const door = this.door();
    do {
      const status = await door.status();
      if (status?.interfaceUp === true) return status.meshAddress;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    } while (Date.now() < deadline);
    return null;
  }

  /** The agent's node status once its door answers, waiting up to `waitMs`. */
  private async status(waitMs = 0): Promise<NodeDoorStatus | null> {
    const deadline = Date.now() + waitMs;
    const door = this.door();
    do {
      const status = await door.status();
      if (status !== null) return status;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    } while (Date.now() < deadline);
    return null;
  }
}
