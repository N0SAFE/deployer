import { Injectable, Logger, Optional } from "@nestjs/common";

import type {
  SetupMeshJoinInput,
  SetupMeshJoinResult,
  SetupMeshStatus,
  SetupMeshTokenInput,
  SetupMeshTokenResult,
} from "@deployer/contracts-entities";
import { nodeDoorFromEnv, type NodeDoorClient } from "@deployer/mesh-client";

import { EnvService } from "@/config/env/env.module";

/**
 * The wizard's mesh surface, over this node's mesh agent.
 *
 * ── WHY THE NODE DOOR AND NOT THE API ──────────────────────────────────────
 * The agent is the only mesh owner on this node, and it answers on a local
 * socket. The API does not exist yet while the wizard runs, so a node that has
 * no platform can still inspect its mesh and join a swarm — which is the whole
 * point of onboarding.
 *
 * ── NO POLLING ─────────────────────────────────────────────────────────────
 * Every method is a read or a one-shot action; the wizard asks when it renders
 * or when the operator clicks. Nothing here schedules a timer.
 */
@Injectable()
export class MeshOnboardingService {
  private readonly logger = new Logger(MeshOnboardingService.name);
  private readonly door: NodeDoorClient;

  /** `door` is the test seam; production resolves it from `NODE_AGENT_SOCKET`. */
  constructor(env: EnvService, @Optional() door?: NodeDoorClient) {
    this.door = door ?? nodeDoorFromEnv(env);
  }

  /** This node's mesh state, or `available: false` when the agent is silent. */
  async getStatus(): Promise<SetupMeshStatus> {
    const status = await this.door.status();
    if (status === null) {
      return {
        available: false,
        agentId: null,
        interfaceUp: false,
        meshAddress: null,
        nodeId: null,
        swarm: null,
      };
    }

    // The platform node id is a label the API stamps once it has booted, so a
    // pre-platform node legitimately has none.
    const view = await this.door.view();

    // WireGuard's own peer list is the honest source: an agent with no
    // configured peers is alone, whatever the roster says.
    const peers = status.peers.map((peer) => ({
      nodeId: peer.nodeId,
      meshAddress: peer.meshAddress,
      handshake: peer.latestHandshakeAt !== null,
    }));

    return {
      available: true,
      agentId: status.agentId,
      interfaceUp: status.interfaceUp,
      meshAddress: status.meshAddress,
      nodeId: view?.self.nodeId ?? null,
      swarm: peers.length === 0 ? null : { nodes: peers.length + 1, peers },
    };
  }

  /**
   * Redeem an invite token.
   *
   * A refusal is returned as `joined: false` with a reason — never thrown. The
   * operator typed a token; a wrong token is an answer, not an outage.
   */
  async join(input: SetupMeshJoinInput): Promise<SetupMeshJoinResult> {
    const result = await this.door.joinWithToken(input.token);
    if (result !== null && result.learned) {
      this.logger.log(`Joined a mesh swarm through the node door (${String(result.agents.length)} agent(s))`);
      // The join result carries the credential and the agents; the swarm identity is a fact about the agent, asked after.
      const joinedStatus = await this.door.status();
      return {
        joined: true,
        swarmId: joinedStatus?.swarmId ?? null,
        agents: result.agents.map((agent) => ({ nodeId: agent.nodeId, address: agent.address })),
        reason: null,
      };
    }

    // Distinguish "the token is bad" from "the agent is not there": the wizard
    // shows the first to the operator and retries the second.
    const valid = await this.door.checkJoinToken(input.token);
    const reason =
      valid === false
        ? "This invite is not valid for this swarm — it may have expired, already been used, or been mistyped."
        : valid === true
          ? "The mesh agent refused the invite even though it is valid. Check the agent's logs."
          : "This node's mesh agent is not answering, so the invite could not be redeemed.";

    this.logger.warn(`Mesh join did not happen: ${reason}`);
    return {
      joined: false,
      swarmId: null,
      agents: result?.agents.map((agent) => ({ nodeId: agent.nodeId, address: agent.address })) ?? [],
      reason,
    };
  }

  /** Issue a one-time invite; `token: null` when the agent does not answer. */
  async issueToken(input: SetupMeshTokenInput): Promise<SetupMeshTokenResult> {
    const issued = await this.door.issueJoinToken(input.ttlMs);
    return { token: issued?.token ?? null };
  }
}
