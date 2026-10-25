import { Injectable, Logger } from "@nestjs/common";
import { SwarmClusterService, SwarmParticipationService } from "@deployer/nest-swarm";

import type { ClusterBootstrapResult, ClusterEntryMode } from "../cluster.types";
import { MeshAgentLauncherService } from "./mesh-agent-launcher.service";

/**
 * Founds or joins the swarm, then publishes the outcome.
 *
 * WHY THE DECISION IS MADE HERE AND NOT IN THE PACKAGE
 * `@deployer/nest-swarm` owns the MECHANISM (init/join, membership wait, snapshot).
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
        const nodeAddress = await resolveSwarmNodeAddress();
        this.logger.log(
          `Ensuring a cluster exists on this node (bound to ${mesh ?? nodeAddress}${mesh === null ? " — resolved interface address, no mesh" : ""})`,
        );
        await this.cluster.ensureCluster(swarmInitOptions(mesh, nodeAddress));
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
 * Init options bound to the mesh address, or to a real interface address when
 * the mesh is not up yet.
 *
 * ── WHY LOOPBACK IS *NOT* A SAFE FALLBACK ──────────────────────────────────
 * This used to fall back to `127.0.0.1` with the reasoning that "a lone node
 * needs no peer to reach it, and it is re-anchored onto its mesh address the
 * first time a joiner needs it". That is true for the CONTROL plane and false
 * for the OVERLAY DATA PATH, and the same address is used for both.
 *
 * A swarm node advertises its address to itself as the data path for VXLAN
 * (4789). With `Status.Addr = 127.0.0.1`, every container that joins an overlay
 * on that node is programmed to tunnel to loopback — so the join never converges
 * and the engine reports, after its own budget expires:
 *
 *   failed to set up container networking: attaching to network failed, make
 *   sure your network options are correct and check manager logs:
 *   context deadline exceeded
 *
 * Measured on the affected node: `docker node inspect self` → `Addr: 127.0.0.1`
 * and `docker run --network deployer-platform-overlay` fails with exactly the
 * message above, while the same container on a bridge network starts fine. Setup
 * then exhausts its 60s attach budget and fails the handover — with an error
 * that names neither the swarm address nor this function.
 *
 * So the fallback resolves a REAL routable interface address. `127.0.0.1` is
 * used only when none exists, which is a genuinely degraded host rather than the
 * common case.
 */
export function swarmInitOptions(
  meshAddress: string | null,
  fallbackAddress: string,
): { ListenAddr: string; AdvertiseAddr: string; DataPathAddr?: string } {
  const host = meshAddress ?? fallbackAddress;
  return {
    ListenAddr: `${host}:2377`,
    AdvertiseAddr: `${host}:2377`,
    // Always set. The data path must be reachable by EVERY task that joins an
    // overlay on this node — including tasks on other nodes — so it can never be
    // loopback. Passing it explicitly also keeps the control plane and the VXLAN
    // endpoint on the same address, which is what makes a later mesh re-anchor
    // safe.
    DataPathAddr: host,
  };
}

/**
 * A non-loopback IPv4 address for this node, for use as the swarm address.
 *
 * Order of preference:
 *   1. `DEPLOYER_SWARM_ADVERTISE_ADDR` — explicit operator override, for a host
 *      with several interfaces where the automatic choice is wrong.
 *   2. The address of the interface carrying the DEFAULT ROUTE (`/proc/net/route`),
 *      which is the host's own outbound address and the one peers can reach.
 *   3. `hostname -I`'s first non-loopback address (covers macOS/most Linux where
 *      `/proc` is absent).
 *   4. `127.0.0.1` — only when the host has no other address at all.
 *
 * Loopback is excluded at every step: it produces a swarm whose overlay can never
 * be joined, which is worse than failing loudly.
 *
 * All I/O goes through Bun builtins — `Bun.file` for reading and `Bun.spawnSync`
 * for the two `ip`/`hostname` probes — so this needs no `node:fs` or
 * `node:child_process` import at all.
 */
export async function resolveSwarmNodeAddress(): Promise<string> {
  const override = process.env.DEPLOYER_SWARM_ADVERTISE_ADDR;
  if (override !== undefined && /^\d+\.\d+\.\d+\.\d+$/.test(override) && !override.startsWith("127.")) {
    return override;
  }

  const loopback = (ip: string | undefined): boolean =>
    ip === undefined || ip === "" || ip === "0.0.0.0" || ip.startsWith("127.");

  // 1. Default-route interface address. `destination 00000000` is the default
  //    route; the address assigned to that interface is what the host uses to
  //    reach everything else.
  const route = await readTextFile("/proc/net/route");
  if (route !== null) {
    for (const line of route.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2 || parts[1] !== "00000000") continue;
      const iface = parts[0];
      if (iface === undefined) continue;
      const ip = await ipv4OfInterface(iface);
      if (!loopback(ip)) return ip as string;
    }
  }

  // 2. Any non-loopback IPv4 the OS reports for this host.
  const reported = runCommand("hostname", ["-I"]);
  if (reported !== null) {
    for (const candidate of reported.split(/\s+/)) {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(candidate) && !loopback(candidate)) return candidate;
    }
  }

  return "127.0.0.1";
}

/**
 * Read a file as UTF-8 text, or `null` when it cannot be read.
 *
 * `Bun.file(...).text()` throws for a missing/unreadable path, and every caller
 * here treats that as "this probe is unavailable, try the next one" — so the
 * null-returning form keeps each call site free of its own try/catch.
 */
async function readTextFile(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

/**
 * Run a command and return its stdout, or `null` on a non-zero exit / missing
 * binary.
 *
 * `Bun.spawnSync` throws when the executable does not exist, so the failure is
 * caught rather than propagated: these are best-effort probes whose absence
 * falls through to the next resolution step.
 */
function runCommand(command: string, args: string[]): string | null {
  try {
    const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) return null;
    return result.stdout.toString();
  } catch {
    return null;
  }
}

/** The IPv4 address assigned to one interface, read via `ip -4 -o addr`. */
async function ipv4OfInterface(iface: string): Promise<string | undefined> {
  const out = runCommand("ip", ["-4", "-o", "addr", "show", "dev", iface]);
  if (out === null) return undefined;
  // "2: eth0    inet 172.18.0.2/16 brd …"
  const match = /inet (\d+\.\d+\.\d+\.\d+)\//.exec(out);
  return match?.[1];
}
