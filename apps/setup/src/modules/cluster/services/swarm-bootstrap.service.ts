import { Injectable, Logger } from "@nestjs/common";
import { SwarmClusterService, SwarmParticipationService } from "@repo/nest-swarm";

import { EnvService } from "@/config/env/env.module";
import type { ClusterBootstrapResult, ClusterEntryMode } from "../cluster.types";

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
    private readonly env: EnvService,
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
        this.logger.log(`Joining an existing cluster (${String(mode.remoteAddrs.length)} addr(s))`);
        await this.cluster.joinCluster({
          joinToken: mode.joinToken,
          remoteAddrs: mode.remoteAddrs,
        });
      } else {
        // `ensureCluster` returns the existing snapshot when the engine is
        // already active, so this is safe on every retry.
        this.logger.log("Ensuring a cluster exists on this node");
        await this.cluster.ensureCluster({
          ListenAddr: "0.0.0.0:2377",
          AdvertiseAddr: this.advertiseAddr(),
        });
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

  /**
   * The address this node advertises for cluster control traffic.
   *
   * ── WHY THIS IS NOT OPTIONAL ────────────────────────────────────────────────
   * `docker swarm init` must publish an address other managers dial. When none is
   * given, the engine tries to INFER one — and refuses outright on a host with
   * more than one candidate:
   *
   *   could not choose an IP address to advertise since this system has
   *   multiple addresses on interface wlp1s0
   *
   * That is a normal machine (IPv4 + IPv6, or several interfaces), so "let the
   * engine decide" fails on real hardware while working on a single-NIC CI box —
   * which is why this must be explicit rather than left to inference.
   *
   * ── PRECEDENCE ──────────────────────────────────────────────────────────────
   * Mirrors the package's own `SwarmParticipationService.initOptions`, and for
   * the same reason: the operator's explicit `SWARM_ADVERTISE_ADDR` wins, then
   * the overlay IP (the address peers actually reach on a mesh), then loopback.
   *
   * `127.0.0.1` is the correct LAST resort, not a bug: for a single-node dev
   * cluster nothing dials the manager, and loopback is always valid — whereas an
   * inferred LAN address is unreachable from inside a container and would make a
   * one-node swarm fail to form.
   */
  private advertiseAddr(): string {
    const explicit = this.env.get("SWARM_ADVERTISE_ADDR")?.trim();
    const overlay = this.env.get("MANAGED_WIREGUARD_IP")?.trim();
    const host = explicit !== undefined && explicit.length > 0
      ? explicit
      : overlay !== undefined && overlay.length > 0
        ? overlay
        : "127.0.0.1";

    return `${host}:2377`;
  }
}
