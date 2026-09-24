/**
 * The platform's supervisor TOPOLOGY — which supervised processes this platform
 * has, and where each one must live in the fleet.
 *
 * BUSINESS LOGIC, deliberately in the app rather than in `@repo/nest-docker`:
 * it names OUR services (ingress, failover proxy, wireguard, global Postgres,
 * redis, the managed console) and their placement rules. The package supplies
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
    supervisorId: "platform-wireguard",
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
