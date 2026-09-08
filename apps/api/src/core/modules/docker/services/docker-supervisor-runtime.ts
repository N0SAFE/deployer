/**
 * Docker-supervisor runtime + topology — how a platform supervisor converges
 * its process, and WHERE that process lives in the fleet.
 *
 * LAYERING (per architecture — NO legacy containers):
 *
 *   - "swarm-global"    — a Docker Swarm GLOBAL service: exactly one task on
 *                         every node. Used for NODE-LOCAL platform infra that
 *                         must exist on each host (ingress, wireguard
 *                         overlay, direct-port proxy).
 *   - "swarm-replicated"— a Docker Swarm REPLICATED service (replicas >= 1).
 *                         Used for MESH-WIDE platform state that is shared
 *                         across the cluster (global Postgres, Redis
 *                         coordination store, managed web console, each
 *                         scaled database-service instance).
 *   - "managed"         — the DEPLOYMENT owns the process (Docker Compose in
 *                         dev, or an operator). The supervisor NEVER spawns
 *                         anything; it only ensures the EXTERNAL NETWORK
 *                         WIRING so the compose/operator-managed container can
 *                         reach (and be reached from) swarm networks.
 *
 * There is intentionally NO "container" runtime: nothing falls back to a
 * dockerode `createContainer`-managed legacy container. When an engine is not
 * swarm-active and the service is not deployment-managed, the supervisor
 * reports `unavailable` (the engine should have been converged by
 * SwarmBootstrapService) instead of silently degrading into a legacy
 * container.
 *
 * WHICH RUNTIME / WHERE (supervisor topology — single source of truth):
 * every platform supervisor declares a `scope`; the scope decides swarm mode:
 *
 *   node-local → swarm-global   (one task per node)
 *   mesh-wide  → swarm-replicated (shared, replicas >= 1)
 *
 * Managed (`MANAGED_*_ENABLED=true`) always wins and means link-only.
 */

/** The three ways a platform supervisor realizes its process. */
export type DockerSupervisorRuntime =
  /** One swarm task on EVERY node — node-local infra. */
  | "swarm-global"
  /** One swarm service with N replicas — shared/mesh-wide infra. */
  | "swarm-replicated"
  /** Deployment-owned (compose/operator): skip spawn, wire networks only. */
  | "managed";

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
export const PLATFORM_SUPERVISOR_TOPOLOGY: readonly SupervisorTopology[] = [
  {
    supervisorId: "platform-ingress-traefik",
    role: "Ingress router (api/web console + mesh routes).",
    // Every node that can serve traffic needs a local ingress to route for the
    // tasks scheduled on it and to publish the console surface on its own
    // entry ports. Global mode keeps api.<host>/web.<host> present on every
    // node, identical to single-node dev/prod parity.
    scope: "node-local",
    rationale:
      "Ingress is per-node: each host publishes the entry ports and routes for locally scheduled tasks. Global = one Traefik per node; the single-node case is identical.",
    replicas: 1,
    constraint: "node.labels.deployer.ingress == true",
  },
  {
    supervisorId: "platform-direct-port-proxy",
    role: "Failover nginx publishing API/web host ports when Traefik is down.",
    scope: "node-local",
    rationale:
      "The direct-port proxy is the per-node rescue lane for the host-published API/web ports — it must exist on whichever node publishes those ports.",
    replicas: 1,
  },
  {
    supervisorId: "platform-redis",
    role: "Redis (idempotency, rate limits, coordination primitives).",
    scope: "mesh-wide",
    rationale:
      "Redis is used for cluster-wide coordination (rate limits, distributed primitives), so it must be a SINGLE shared service — a per-node cache would fragment counters/locks. Replicated 1 (single logical store).",
    replicas: 1,
  },
  {
    supervisorId: "global-db-postgres",
    role: "Global Postgres (the platform's shared state DB).",
    scope: "mesh-wide",
    rationale:
      "The global database is the single cluster-wide state store every node shares (one deployer DB). Replicated 1 on the mesh; when a real HA Postgres is wired it scales via replicas/promotion, still mesh-wide.",
    replicas: 1,
  },
  {
    supervisorId: "database-service",
    role: "Scaled Postgres instances (one logical DB per instance, alias-reachable).",
    scope: "mesh-wide",
    rationale:
      "Each database-service instance is a shared logical database reachable by alias (db-<instance>) from any overlay service — a replicated swarm service per instance (per-instance named volume). 'Managed databases handled by swarm.'",
    replicas: 1,
  },
  {
    supervisorId: "platform-managed-web",
    role: "Managed web console container (flag-controlled).",
    scope: "mesh-wide",
    rationale:
      "The console is a single logical app serving the whole platform — replicated 1 (not per-node).",
    replicas: 1,
  },
  {
    supervisorId: "wireguard",
    role: "WireGuard mesh overlay sidecar (one per node, own overlay IP).",
    scope: "node-local",
    rationale:
      "WireGuard is a mesh LAYER: each node owns its sidecar + overlay IP. Global = one sidecar per node, joined with MANAGED_WIREGUARD_IP.",
    replicas: 1,
  },
] as const;

/** Index the topology by supervisor id for O(1) lookups. */
export const PLATFORM_SUPERVISOR_TOPOLOGY_BY_ID: ReadonlyMap<string, SupervisorTopology> =
  new Map(PLATFORM_SUPERVISOR_TOPOLOGY.map((t) => [t.supervisorId, t]));

/** Runtime a supervisor uses when it is NOT deployment-managed. */
export function swarmRuntimeForScope(scope: SupervisorScope): DockerSupervisorRuntime {
  return scope === "node-local" ? "swarm-global" : "swarm-replicated";
}

/** Topology lookup; returns null for unknown/not-docker supervisors. */
export function getSupervisorTopology(supervisorId: string): SupervisorTopology | null {
  return PLATFORM_SUPERVISOR_TOPOLOGY_BY_ID.get(supervisorId) ?? null;
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
 *   3. Otherwise the declared SCOPE decides the swarm mode:
 *        node-local → swarm-global ; mesh-wide → swarm-replicated.
 *   4. If the engine is NOT swarm-active, the result is `unavailable` — there
 *      is NO legacy-container fallback. SwarmBootstrapService converges the
 *      engine on boot, so this only happens on a genuinely constrained host;
 *      the supervisor reports unavailable instead of silently creating a
 *      legacy container.
 */
export interface ResolvedSupervisorRuntime {
  readonly runtime: DockerSupervisorRuntime | "unavailable";
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
  if (runtimeRaw === "swarm" || runtimeRaw === "auto") {
    if (!input.swarmActive) {
      return {
        runtime: "unavailable",
        reason:
          `Runtime for ${desired} requires an active swarm engine, but the local engine is not ` +
          `swarm-active. No legacy-container fallback exists — SwarmBootstrapService should have ` +
          `converged the engine on boot.`,
      };
    }
    return {
      runtime: desired,
      reason: `scope=${scope} → ${desired} on the active swarm engine.`,
    };
  }

  // Unknown raw value — treat as auto.
  if (!input.swarmActive) {
    return {
      runtime: "unavailable",
      reason: `Unknown SUPERVISOR_RUNTIME "${runtimeRaw}" and the engine is not swarm-active — no legacy fallback.`,
    };
  }
  return { runtime: desired, reason: `Unknown SUPERVISOR_RUNTIME "${runtimeRaw}" treated as auto → ${desired}.` };
}

/** Suffix appended to a compose bridge network name to derive the swarm overlay. */
export const PLATFORM_OVERLAY_SUFFIX = "-overlay";

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

