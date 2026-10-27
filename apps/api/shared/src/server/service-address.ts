/**
 * The services the API surface is split into, and where each one answers.
 *
 * A service's NAME is also its ADDRESS in the composed `appContract` — the BFF
 * mounts one router per namespace and forwards `/project/...` to the service
 * named `project`. Keeping one identifier for both is what removes the routing
 * table: there is nothing to keep in sync, because there is only one value.
 *
 * `defaultPort` is the in-container port. The orchestrator overrides it per
 * service when it schedules them, and `API_SERVICE_PORTS` (a JSON map) lets an
 * operator re-map without a rebuild — but the defaults are what dev uses, so a
 * developer never has to set anything.
 */
export const API_SERVICES = {
  health: { defaultPort: 3101, description: "Liveness/readiness probes and the platform supervisor roll-up." },
  identity: { defaultPort: 3102, description: "Users, permissions, analytics and push notifications." },
  project: { defaultPort: 3103, description: "Projects, services and domains." },
  fleet: { defaultPort: 3104, description: "Cluster, fleet nodes, providers, reachability and the platform surface." },
  runtime: { defaultPort: 3105, description: "Docker, deployments and build/runtime runners." },
} as const;

/** The name of a service (also its contract namespace / bus address). */
export type ApiServiceName = keyof typeof API_SERVICES;

/** Every service name, in declaration order. */
export const API_SERVICE_NAMES = Object.keys(API_SERVICES) as ApiServiceName[];

/** The port a service binds, honouring the operator's override when present. */
export function apiServicePort(name: ApiServiceName): number {
  const override = readPortOverride(name);
  return override ?? API_SERVICES[name].defaultPort;
}

/**
 * `API_SERVICE_PORTS` override, e.g. `{"project":3203}`.
 *
 * Read defensively: this runs during boot, before any env module has validated
 * anything, so a malformed value must fall back to the default rather than
 * crash the service with a parse error it cannot report.
 */
function readPortOverride(name: ApiServiceName): number | undefined {
  const raw = process.env.API_SERVICE_PORTS;
  if (raw === undefined || raw === "") return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const value = (parsed as Record<string, unknown>)[name];
    return typeof value === "number" && Number.isInteger(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where the BFF reaches a service.
 *
 * Inside the platform network a service is reached by its compose/swarm SERVICE
 * NAME (`http://svc-project:3103`), which is also how the orchestrator schedules
 * them. `API_SERVICE_URLS` overrides the whole URL for an operator running a
 * service elsewhere.
 */
export function apiServiceUrl(name: ApiServiceName): string {
  const override = readUrlOverride(name);
  return override ?? `http://svc-${name}:${String(apiServicePort(name))}`;
}

function readUrlOverride(name: ApiServiceName): string | undefined {
  const raw = process.env.API_SERVICE_URLS;
  if (raw === undefined || raw === "") return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const value = (parsed as Record<string, unknown>)[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}
