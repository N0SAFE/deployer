import { Injectable, Logger } from "@nestjs/common";
import { SwarmClusterService, SwarmParticipationService } from "@repo/nest-swarm";

import type { ClusterBootstrapResult, ClusterEntryMode } from "../cluster.types";
import { MeshAgentLauncherService } from "./mesh-agent-launcher.service";

/**
 * Founds or joins the swarm, then publishes the outcome.
 *
 * WHY THE DECISION IS MADE HERE AND NOT IN THE PACKAGE
 * `@repo/nest-swarm` owns the MECHANISM (init/join, membership wait, snapshot).
 * This service owns the DECISION of which one to run, and that decision is this
 * platform's onboarding policy: `SETUP_MODE=prod` founds a cluster, and the
 * wizard's join path joins one. A package that picked for us would be exporting
 * business logic — the exact thing §8.7 forbids.
 *
 * IDEMPOTENT BY CONSTRUCTION: the engine refuses a second `init` on an already
 * active node, and `SwarmParticipationService.converge()` re-reads the persisted
 * decision. Re-running setup therefore converges instead of failing.
 */
@Injectable()
export class SwarmBootstrapService {
  private readonly logger = new Logger(SwarmBootstrapService.name);

  constructor(
    private readonly cluster: SwarmClusterService,
    private readonly participation: SwarmParticipationService,
    private readonly meshAgent: MeshAgentLauncherService,
  ) {}

  /**
   * Bring the engine into a cluster and report what happened.
   *
   * Never throws: a node that cannot found or join a cluster must still be able
   * to serve the wizard, because the wizard is the only surface that can tell
   * the operator what went wrong. The failure is returned as data so the caller
   * decides whether to degrade or fail the phase.
   */
  async bootstrap(mode: ClusterEntryMode): Promise<ClusterBootstrapResult> {
    try {
      if (mode.kind === "join") {
        // A wizard-supplied token joins over whatever network reaches the
        // managers; the mesh-first path is the API's remote join, which admits
        // this node into the mesh BEFORE Swarm dials a manager's mesh address.
        await this.meshAgent.ensureRunning();
        this.logger.log(`Joining an existing cluster (${String(mode.remoteAddrs.length)} addr(s))`);
        await this.cluster.joinCluster({
          joinToken: mode.joinToken,
          remoteAddrs: mode.remoteAddrs,
          meshAddress: await this.meshAgent.meshAddress(),
        });
      } else {
        // THE MESH FIRST: the swarm binds this node's mesh address, which only
        // exists once the agent has founded the mesh and brought the interface up.
        const mesh = await this.meshAgent.foundAndResolveAddress();
        // `ensureCluster` returns the existing snapshot when the engine is
        // already active, so this is safe on every retry.
        this.logger.log(`Ensuring a cluster exists on this node (bound to ${mesh ?? "loopback — no mesh interface"})`);
        await this.cluster.ensureCluster(swarmInitOptions(mesh));
      }

      // `converge()` applies the node POLICY (role, availability, labels) once
      // the engine is in a cluster — joining alone only sets membership,
      // leaving the node unlabelled and therefore excluded by the platform's
      // placement constraints.
      const snapshot = await this.participation.converge();
      const local = snapshot.localNode;

      this.logger.log(
        `Cluster active — state=${snapshot.localNodeState}, role=${local.swarmRole}, ` +
          `nodes=${String(snapshot.nodeCount)}, managers=${String(snapshot.managerCount)}`,
      );

      return {
        ok: true,
        nodeId: local.nodeId,
        swarmRole: local.swarmRole,
        nodeCount: snapshot.nodeCount,
        managerCount: snapshot.managerCount,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cluster bootstrap failed: ${detail}`);
      return { ok: false, reason: detail };
    }
  }
}

/**
 * Init options bound to the mesh address, or loopback without one.
 *
 * Listen, advertise and data path all use the SAME address, so the control plane
 * (2377, 7946) and the overlay data path (4789) are never bound on a public
 * interface. `127.0.0.1` is the right fallback, not a bug: a lone node needs no
 * peer to reach it, and it is re-anchored onto its mesh address the first time a
 * joiner needs it (`SwarmJoinGrantService`).
 */
export function swarmInitOptions(meshAddress: string | null): { ListenAddr: string; AdvertiseAddr: string; DataPathAddr?: string } {
  const host = meshAddress ?? "127.0.0.1";
  return {
    ListenAddr: `${host}:2377`,
    AdvertiseAddr: `${host}:2377`,
    ...(meshAddress === null ? {} : { DataPathAddr: meshAddress }),
  };
}
