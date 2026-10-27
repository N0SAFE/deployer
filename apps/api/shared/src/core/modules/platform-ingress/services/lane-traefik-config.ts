/**
 * Lane config builder — turns routes × lanes into the Traefik dynamic configuration
 * every ingress task polls from the API.
 *
 * Pure: no env, no database, no Docker. The inputs are the lanes the operator
 * enabled, the base domain of each lane and the routes; the output is the exact
 * object Traefik receives. That is what makes "which lanes can reach this route?"
 * auditable by reading one function and testable without a cluster.
 *
 * ── THE RULES ───────────────────────────────────────────────────────────────
 *   - one router per (route, lane), bound to that lane's entrypoint ONLY — a
 *     router on `local` can never answer a request that arrived on `public`;
 *   - a route's `visibility` picks its lanes (`lanesForVisibility`): a `private`
 *     route simply has no public router, so the public lane 404s it;
 *   - generated hosts are `<label>.<lane domain>`; explicit hosts (custom domains,
 *     a node's public address) exist on the PUBLIC lane only, because they are
 *     public DNS names by definition;
 *   - when the public edge asks Traefik to serve HTTPS itself (`acme`, e.g. the
 *     `direct` edge with TLS) the public routers sit on `public-tls` with the ACME
 *     resolver (plain `public` redirects there at the entrypoint level). An edge
 *     that terminates TLS itself (a tunnel) keeps them on plain `public`.
 */

import {
	lanesForVisibility,
	type IngressLane,
	type IngressLanes,
	type RouteVisibility,
} from "@deployer/contracts-entities/entities/ingress/index";

/** Name of the ACME resolver declared in the ingress's static arguments (used on `public-tls`). */
export const TRAEFIK_ACME_RESOLVER = "letsencrypt";

/** Traefik entrypoints, one per lane. Container ports — never published except `direct`. */
export const LANE_ENTRYPOINTS = {
	/** The local lane keeps :80 so everything that dials `deployer-traefik:80` on the overlay still lands on it. */
	local: { name: "local", port: 80 },
	private: { name: "private", port: 8001 },
	public: { name: "public", port: 8002 },
	publicTls: { name: "public-tls", port: 8443 },
} as const;

/** One route the ingress publishes, independent of lanes. */
export type LaneRoute = {
	/** Unique router-name base (`[a-z0-9-]`). Routers are `<name>-<lane>`. */
	name: string;
	/** Subdomains on the generated lane domains (`api` → `api.deployer.localhost`). */
	labels: readonly string[];
	/** Explicit FQDNs served on the PUBLIC lane only (custom domains, public address). */
	publicHosts?: readonly string[];
	visibility: RouteVisibility;
	/** Service (backend) name, shared by every lane's router. */
	service: string;
	/** Appended to the host rule, e.g. "&& PathPrefix(`/manage/web-app`)". */
	ruleSuffix?: string;
	middlewares?: readonly string[];
	priority?: number;
}

export type LaneDomains = {
	local: string;
	private: string;
	/** Null when no public lane is enabled. */
	public: string | null;
}

export type LaneConfigInput = {
	lanes: IngressLanes;
	domains: LaneDomains;
	routes: readonly LaneRoute[];
	/** Service name → backend URL. */
	services: Readonly<Record<string, string>>;
	/** Middleware name → raw Traefik middleware definition. */
	middlewares?: Readonly<Record<string, unknown>>;
	/** ACME resolver name used on `public-tls`. */
	tlsResolver: string;
	/** The public edge wants Traefik to obtain certificates (`EdgeIngressPlan.tls === "acme"`). */
	publicAcme: boolean;
}

type TraefikRouter = {
	rule: string;
	service: string;
	entryPoints: string[];
	middlewares?: string[];
	priority?: number;
	tls?: { certResolver: string };
}

export type LaneTraefikConfig = {
	http: {
		routers: Record<string, TraefikRouter>;
		services: Record<string, { loadBalancer: { servers: { url: string }[] } }>;
		middlewares?: Record<string, unknown>;
	};
}

function hostRule(hosts: readonly string[]): string {
	const unique = [...new Set(hosts)];
	const parts = unique.map((host) => `Host(\`${host}\`)`);
	const [only] = parts;
	return parts.length === 1 && only !== undefined ? only : `(${parts.join(" || ")})`;
}

function laneHosts(route: LaneRoute, lane: IngressLane, domains: LaneDomains): string[] {
	const domain = lane === "local" ? domains.local : lane === "private" ? domains.private : domains.public;
	const generated = domain === null ? [] : route.labels.map((label) => `${label}.${domain}`);
	return lane === "public" ? [...generated, ...(route.publicHosts ?? [])] : generated;
}

/** Build the dynamic configuration for every route on every lane it is visible on. */
export function buildLaneTraefikConfig(input: LaneConfigInput): LaneTraefikConfig {
	const routers: Record<string, TraefikRouter> = {};
	const referenced = new Set<string>();
	const tls = input.publicAcme && input.lanes.public !== null;

	for (const route of input.routes) {
		if (input.services[route.service] === undefined) continue;
		for (const lane of lanesForVisibility(route.visibility, input.lanes)) {
			const hosts = laneHosts(route, lane, input.domains);
			if (hosts.length === 0) continue;
			const router: TraefikRouter = {
				rule: route.ruleSuffix === undefined ? hostRule(hosts) : `${hostRule(hosts)} ${route.ruleSuffix}`,
				service: route.service,
				entryPoints: [lane === "public" && tls ? LANE_ENTRYPOINTS.publicTls.name : LANE_ENTRYPOINTS[lane].name],
			};
			if (route.middlewares !== undefined && route.middlewares.length > 0) router.middlewares = [...route.middlewares];
			if (route.priority !== undefined) router.priority = route.priority;
			if (lane === "public" && tls) router.tls = { certResolver: input.tlsResolver };
			routers[`${route.name}-${lane}`] = router;
			referenced.add(route.service);
		}
	}

	const services: LaneTraefikConfig["http"]["services"] = {};
	for (const name of [...referenced].sort()) {
		const url = input.services[name];
		if (url !== undefined) services[name] = { loadBalancer: { servers: [{ url }] } };
	}

	const config: LaneTraefikConfig = { http: { routers, services } };
	if (input.middlewares !== undefined && Object.keys(input.middlewares).length > 0) {
		config.http.middlewares = { ...input.middlewares };
	}
	return config;
}
