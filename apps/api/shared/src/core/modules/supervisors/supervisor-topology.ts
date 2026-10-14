/**
 * The platform's supervisor TOPOLOGY — which supervised processes this platform
 * has, and where each one must live in the fleet.
 *
 * BUSINESS LOGIC, deliberately in the app rather than in `@repo/nest-docker`:
 * it names OUR services (ingress, tunnel connectors, global Postgres, redis, the
 * managed console) and their placement rules.
 *
 * What is NOT here, by design: the WireGuard interface and the per-node doors in
 * front of Traefik. Both belong to the node's MESH AGENT, which runs below Swarm
 * (it must exist before Swarm does) — see docs/edge-mesh-architecture.md. The package supplies
 * the MECHANISM (the runtime/scope vocabulary and the resolver); this file is
 * the platform DECISION the mechanism operates on.
 *
 * NOTE: `local-db-sqlite` (the node's own SQLite state file) is NOT docker —
 * it is always owned by the API process and never scheduled; excluded by design.
 */
import type { SupervisorTopology } from "@repo/nest-docker/services/docker-supervisor-runtime";

export const PLATFORM_SUPERVISOR_TOPOLOGY: readonly SupervisorTopology[] = [
  {
    supervisorId: "platform-ingress-traefik",
    role: "Ingress router — one entrypoint per lane (local, private, public), routes polled from the API.",
    scope: "node-local",
    rationale:
      "Every node runs its own doors (loopback, mesh address) and each door forwards to the LOCAL lane entrypoint, so every node needs an ingress task. Global = one Traefik per node; no socket, no config volume.",
    replicas: 1,
  },
  {
    supervisorId: "platform-edge-connector",
    role: "Connector of the public edge, when its provider is a tunnel (outbound only).",
    scope: "mesh-wide",
    rationale:
      "Connectors dial out and publish nothing, so nothing about them is node-local: replicated, at most one per node, all serving the ONE stack edge. The image and credential come from the edge provider.",
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
] as const;

/** Index the topology by supervisor id for O(1) lookups. */
export const PLATFORM_SUPERVISOR_TOPOLOGY_BY_ID: ReadonlyMap<string, SupervisorTopology> =
  new Map(PLATFORM_SUPERVISOR_TOPOLOGY.map((t) => [t.supervisorId, t]));
