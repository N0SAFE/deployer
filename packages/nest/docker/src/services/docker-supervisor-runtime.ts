/**
 * Docker-supervisor runtime + scope — how a supervised process is realized on
 * the engine, and WHERE it must live in the fleet.
 *
 * A FRAMEWORK PRIMITIVE. It answers "swarm-global, swarm-replicated, managed or
 * unavailable?" for any supervisor, and never names one. The platform's OWN
 * supervisor table (which services exist and their placement) lives in the app
 * — see `apps/api/src/core/modules/supervisors/supervisor-topology.ts`.
 *
 * LAYERING:
 *   "swarm-global"     — one task on EVERY node (node-local infra).
 *   "swarm-replicated" — one service, N replicas (shared/mesh-wide infra).
 *   "managed"          — the deployment owns the process (compose/operator):
 *                        never spawn, only wire the networks so it is reachable.
 *   "unavailable"      — the engine is not an active swarm member, so there is
 *                        nowhere to schedule it. The supervisor goes DEGRADED
 *                        with an actionable message; it NEVER falls back to a
 *                        plain container.
 *
 * THERE IS NO CONTAINER RUNTIME. Keeping a second, container-based convergence
 * path would mean two implementations of every supervisor's behaviour.
 */
/** The ways a platform supervisor realizes its process. */
export type DockerSupervisorRuntime =
  /** One swarm task on EVERY node — node-local infra. */
  | "swarm-global"
  /** One swarm service with N replicas — shared/mesh-wide infra. */
  | "swarm-replicated"
  /** Deployment-owned (compose/operator): skip spawn, wire networks only. */
  | "managed"
  /** Engine is not an active swarm member — nothing can be scheduled. */
  | "unavailable";

/** Where a supervisor's process must live in the fleet. */
export type SupervisorScope = "node-local" | "mesh-wide";

/** Why a supervisor is node-local vs mesh-wide (documented rationale). */
export interface SupervisorTopology {
  /** Stable supervisor identifier (matches the service's static identifier). */
  readonly supervisorId: string;
  /** What the process actually does (drives the scope decision). */
  readonly role: string;
  /**
   * node-local → swarm-global service (one per node).
   * mesh-wide  → swarm-replicated service (shared across the cluster).
   */
  readonly scope: SupervisorScope;
  /** Human-readable rationale for the classification. */
  readonly rationale: string;
  /** Replicas used when scope is mesh-wide (ignored for node-local/global). */
  readonly replicas: number;
  /** Constraint applied to the swarm service (e.g. ingress-labelled nodes). */
  readonly constraint?: string;
}

/**
 * Canonical classification of the docker-backed platform supervisors.
 *
 * Deployer's OWN platform infra is scheduled on swarm so that a node in the
 * fleet has exactly the right topology of shared vs per-node services, while
 * the dev compose profile keeps using `docker compose up/down` for the same
 * names via the `managed` runtime (link-only).
 *
 * NOTE: `local-db-sqlite` (the node's own SQLite state file) is NOT docker —
 * it is always owned by the API process and never scheduled; it is excluded
 * here by design.
 */

/** Runtime a supervisor uses when it is NOT deployment-managed. */
export function swarmRuntimeForScope(scope: SupervisorScope): DockerSupervisorRuntime {
  return scope === "node-local" ? "swarm-global" : "swarm-replicated";
}

/** Raw `SUPERVISOR_RUNTIME` env accepted values. */
export const SUPERVISOR_RUNTIME_RAW = ["auto", "swarm", "managed"] as const;
export type SupervisorRuntimeRaw = (typeof SUPERVISOR_RUNTIME_RAW)[number];

/**
 * Resolve the supervisor runtime.
 *
 * Rules:
 *   1. `managed=true` (deployment/compose owns the process) ALWAYS wins → the
 *      supervisor never spawns; it only wires external networks.
 *   2. `SUPERVISOR_RUNTIME=managed` forces the managed/link-only behavior even
 *      when the flag is off (operator runs compose but forgot the flag).
 *   3. When the engine IS swarm-active, the declared SCOPE decides the swarm
 *      mode: node-local → swarm-global ; mesh-wide → swarm-replicated.
 *   4. When the engine is NOT swarm-active there is NO container fallback:
 *      the result is `unavailable` and the supervisor goes DEGRADED. This
 *      state is reachable only when swarm convergence failed (no engine, an
 *      edge node that was explicitly excluded, or participation disabled) —
 *      never on a normal boot, because `SwarmBootstrapService` converges the
 *      engine before the supervisors.
 */
export interface ResolvedSupervisorRuntime {
  readonly runtime: DockerSupervisorRuntime;
  /** Why this decision was made (drives logs + operator messages). */
  readonly reason: string;
}

export function resolveSupervisorRuntime(input: {
  /** MANAGED_<SERVICE>_ENABLED (deployment owns the process). */
  managed: boolean;
  /** Raw SUPERVISOR_RUNTIME (optional; defaults to auto). */
  rawRuntime?: string | undefined;
  /** Engine is an active swarm member. */
  swarmActive: boolean;
  /** Declared scope of the supervisor (unknown → mesh-wide safest). */
  scope?: SupervisorScope | null | undefined;
}): ResolvedSupervisorRuntime {
  const scope: SupervisorScope = input.scope ?? "mesh-wide";
  const runtimeRaw: string = input.rawRuntime ?? "auto";

  if (input.managed || runtimeRaw === "managed") {
    return {
      runtime: "managed",
      reason: input.managed
        ? "Deployment owns this service (MANAGED_*_ENABLED=true) — link-only wiring, never spawned."
        : "SUPERVISOR_RUNTIME=managed forced — link-only wiring, never spawned.",
    };
  }

  const desired = swarmRuntimeForScope(scope);
  if (!input.swarmActive) {
    return {
      runtime: "unavailable",
      reason:
        `Engine is not an active swarm member — cannot schedule this supervised process as ${desired}. ` +
        `SwarmBootstrapService converges the cluster at boot; check its log for the convergence failure ` +
        `(no docker engine, or the node was excluded from swarm participation).`,
    };
  }
  if (runtimeRaw === "swarm" || runtimeRaw === "auto") {
    return {
      runtime: desired,
      reason: `scope=${scope} → ${desired} on the active swarm engine.`,
    };
  }
  return { runtime: desired, reason: `Unknown SUPERVISOR_RUNTIME "${runtimeRaw}" treated as auto → ${desired}.` };
}

/** Suffix appended to a compose bridge network name to derive the swarm overlay. */
export const PLATFORM_OVERLAY_SUFFIX = "-overlay";

/** Base name of the platform network (per-`DEPLOYER_PREFIX` instances append it). */
export const PLATFORM_NETWORK_BASE_NAME = "deployer-platform";

/**
 * Canonical name of the platform network every platform process shares.
 * SINGLE SOURCE OF TRUTH (the docker layer owns it because supervisors, the
 * managed-database containers and the swarm wiring all need it).
 */
export function platformNetworkName(prefix?: string | null): string {
  return prefix === undefined || prefix === null || prefix === ""
    ? PLATFORM_NETWORK_BASE_NAME
    : `${PLATFORM_NETWORK_BASE_NAME}-${prefix}`;
}

/**
 * Derive the attachable OVERLAY name for a platform network.
 * e.g. `deployer-platform` → `deployer-platform-overlay`.
 *
 * Compose declares the bridge (`deployer-platform`). The overlay is the
 * swarm-scoped counterpart compose-managed containers are wired INTO at boot
 * (`ensureExternalWiring`) so compose services and swarm-scheduled services
 * share one DNS namespace.
 */
export function platformOverlayNetworkName(baseNetworkName: string): string {
  return baseNetworkName.endsWith(PLATFORM_OVERLAY_SUFFIX)
    ? baseNetworkName
    : `${baseNetworkName}${PLATFORM_OVERLAY_SUFFIX}`;
}

/** The attachable overlay for the platform network at `DEPLOYER_PREFIX`. */
export function platformOverlayForPrefix(prefix?: string | null): string {
  return platformOverlayNetworkName(platformNetworkName(prefix));
}

