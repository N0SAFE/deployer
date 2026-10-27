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
 * ── THE ADDRESS MUST BE ONE `dockerd` CAN BIND, WHICH IS NOT THE CONTAINER'S ──
 * `docker swarm init --advertise-addr` is executed against the DAEMON, and the
 * daemon binds the address on the HOST it runs on. Returning the address of the
 * interface INSIDE this process's network namespace therefore cannot work: the
 * daemon does not own it, and swarm init fails with
 *
 *   manager stopped: failed to listen on remote API address:
 *   listen tcp 172.25.0.2:2377: bind: cannot assign requested address
 *
 * Measured on the affected setup container:
 *
 *   /proc/net/route  eth0 default gw 010019AC  → 172.25.0.1
 *   ip -4 addr       eth0 172.25.0.2/16, eth1 172.27.0.2/16
 *   host             br-… 172.25.0.1/16           ← the HOST owns .1, not .2
 *
 * So when this process is containerised, the correct answer is the DEFAULT
 * GATEWAY — that is the host's address on the container's bridge, and the one
 * the daemon can bind. On a host process the default-route interface address is
 * already correct, so the same probe serves both cases.
 *
 * Order of preference:
 *   1. `DEPLOYER_SWARM_ADVERTISE_ADDR` — explicit operator override, for a host
 *      with several interfaces where the automatic choice is wrong.
 *   2. Inside a container (`/.dockerenv` or `KUBERNETES_SERVICE_HOST`): the
 *      default gateway, i.e. the host on this container's bridge.
 *   3. Bare metal: the default-route interface's own address.
 *   4. `hostname -I`'s first non-loopback address.
 *   5. `127.0.0.1` — only when the host has no other address at all.
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

  const loopback = (ip: string | null | undefined): boolean =>
    ip === undefined || ip === null || ip === "" || ip === "0.0.0.0" || ip.startsWith("127.");

  const route = await readTextFile("/proc/net/route");
  const defaultIface = route === null ? null : defaultRouteInterface(route);

  // ── CONTAINERISED: THE HOST'S ADDRESS, NOT OURS ───────────────────────────
  // The daemon binds on the host, so the container's own interface address is
  // unbindable there. The default gateway IS the host on this bridge.
  if (await isRunningInContainer()) {
    const gateway = route === null ? null : defaultRouteGateway(route);
    if (!loopback(gateway)) return gateway!;
  }

  // 1. Default-route interface address (bare metal: this IS the host).
  if (defaultIface !== null) {
    const ip = await ipv4OfInterface(defaultIface);
    if (!loopback(ip)) return ip!;
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
 * Is this process running inside a container?
 *
 * `/.dockerenv` is created by Docker for every container; `KUBERNETES_SERVICE_HOST`
 * covers k8s pods (which have no `/.dockerenv`). Both are cheap file/env probes
 * with no dependency on the daemon.
 */
async function isRunningInContainer(): Promise<boolean> {
  if (process.env.KUBERNETES_SERVICE_HOST !== undefined) return true;
  return await Bun.file("/.dockerenv").exists();
}

/** The interface carrying the default route (`destination 00000000`), or null. */
function defaultRouteInterface(routeTable: string): string | null {
  for (const line of routeTable.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2 || parts[1] !== "00000000") continue;
    return parts[0] ?? null;
  }
  return null;
}

/**
 * The default route's gateway address, decoded from the kernel's little-endian
 * hex form (`010019AC` → `172.25.0.1`), or null when it cannot be decoded.
 *
 * `destination 00000000` identifies the default route; field 2 is its gateway.
 * A gateway of `00000000` means "directly connected, no gateway" and is rejected.
 */
function defaultRouteGateway(routeTable: string): string | null {
  for (const line of routeTable.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || parts[1] !== "00000000") continue;
    const hex = parts[2] ?? "";
    if (hex.length < 8 || hex === "00000000") return null;
    // Stored little-endian: reverse the byte order.
    const octets = [
      parseInt(hex.slice(6, 8), 16),
      parseInt(hex.slice(4, 6), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(0, 2), 16),
    ];
    if (octets.some((octet) => Number.isNaN(octet))) return null;
    return octets.join(".");
  }
  return null;
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
