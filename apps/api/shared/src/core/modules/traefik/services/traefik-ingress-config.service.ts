/**
 * TraefikIngressConfigService — the ONE dynamic configuration every ingress task
 * polls from the API (Traefik's HTTP provider).
 *
 * ── WHY THE API SERVES IT INSTEAD OF WRITING FILES ──────────────────────────
 * Routes used to be YAML files the API wrote into a named volume that Traefik's
 * file provider watched. A named volume is NODE-LOCAL: on a multi-node cluster
 * the ingress on every other node mounted its own empty copy and routed nothing.
 * Serving the configuration over HTTP gives every node the identical answer, needs
 * no Docker socket and no volume in Traefik, and a node that loses the API keeps
 * routing with the last configuration it fetched.
 *
 * ── WHAT IS IN IT ───────────────────────────────────────────────────────────
 * Every route is built ONCE, lane-agnostic, then `buildLaneTraefikConfig` attaches
 * it to the lanes its visibility allows:
 *
 *   platform-api / platform-web / console   labels api, web       console visibility
 *   platform-setup                          label  setup          console visibility
 *   deployments, previews                   label  <svc>-<proj>   service visibility
 *   global address, per-service domains     public hosts only     public
 */

import { readFile } from "node:fs/promises";

import { Context, Effect } from "effect";

import type { RouteVisibility } from "@deployer/contracts-entities/entities/ingress/index";
import type { DockerEngineShape } from "@deployer/docker";

import { buildLaneTraefikConfig, TRAEFIK_ACME_RESOLVER, type LaneRoute, type LaneTraefikConfig } from "../../platform-ingress/services/lane-traefik-config";
import { PLATFORM_WEB_INTERNAL_PORT } from "../../platform-ingress/services/platform-names";
import { PlatformPaths } from "../../platform-ingress/services/platform-paths";
import { resolveSelfContainerName } from "../../platform-ingress/services/platform-self-resolver";

import type { IngressLanesUnavailable } from "../../platform-ingress/platform-ingress.errors";
import type { EnvService } from "../../../../config/env/env.module";
import type { EdgeProviderRegistryShape } from "../../edge/edge-provider.registry";
import type { HostnameService } from "../../platform-ingress/services/hostname.service";
import type { IngressLanesServiceShape } from "../../platform-ingress/services/ingress-lanes.service";
import type { PlatformConfigServiceShape } from "../../platform-ingress/services/platform-config.service";
import type { PlatformRoutesSourceShape, SupervisedRoute } from "../../platform-ingress/services/platform-routes-source.service";
import type { PlatformWebTargetServiceShape } from "../../platform-ingress/services/platform-web-target.service";
import type { TraefikRepositoryShape } from "../repositories/traefik.repository";

/** The router that answers the console's single URL on the platform's own hosts. */
export const PLATFORM_WEB_CONSOLE_PATH = "/manage/web-app";
/** The handover's destination page — exempt from the setup-host redirect. */
const SETUP_DONE_PATH = "/setup/done";

const SERVICES = {
	api: "platform-api-svc",
	web: "platform-web-svc",
	console: "platform-web-console-svc",
	setup: "platform-setup-svc",
} as const;
const SETUP_REDIRECT_MIDDLEWARE = "platform-setup-redirect";

// Explicit priorities: the setup host is DEDICATED (nothing else may claim it), and
// the console rule must beat the Host-only platform routers on its path.
const PRIORITY = { console: 2000, setup: 3000, setupRedirect: 3100 } as const;

/** Where `setup.<host>` points right now. */
export type SetupRouteTarget = {
	url: string;
	/** True while setup's own wizard still serves the hostname (mid-handover). */
	servedBySetup: boolean;
}

export type TraefikIngressConfigServiceShape = {
	/** The ONE dynamic configuration every ingress task polls. A source that is not ready (no global DB yet) contributes nothing; only the lanes themselves are required. */
	readonly buildDynamicConfig: () => Effect.Effect<LaneTraefikConfig, IngressLanesUnavailable>;
	/**
	 * Where `setup.<host>` points. Setup declares its hostname's backend in its handover file (the one contract between the two
	 * apps, in the config volume both mount). While that backend is not the API's done page, setup is mid-handover and keeps its
	 * route; once it repoints at the done page (or the file is gone) the API owns the hostname.
	 */
	readonly setupRouteTarget: (apiBackend: string) => Effect.Effect<SetupRouteTarget>;
};

type Ports = {
	readonly env: EnvService;
	readonly dockerEngine: DockerEngineShape;
	readonly hostnames: HostnameService;
	readonly lanes: IngressLanesServiceShape;
	readonly webTarget: PlatformWebTargetServiceShape;
	readonly routesSource: PlatformRoutesSourceShape;
	readonly traefikRepository: TraefikRepositoryShape;
	readonly platformConfig: PlatformConfigServiceShape;
	readonly edges: EdgeProviderRegistryShape;
};

export function makeTraefikIngressConfigService(ports: Ports): TraefikIngressConfigServiceShape {
	const { env, dockerEngine, hostnames, lanes, webTarget, routesSource, traefikRepository, platformConfig, edges } = ports;

	/** The API's own backend on the platform overlay. */
	const apiBackend = Effect.map(
		resolveSelfContainerName(dockerEngine.containers, env),
		(name) => `http://${name}:${String(env.get("API_PORT"))}`,
	);

	const setupRouteTarget: TraefikIngressConfigServiceShape["setupRouteTarget"] = (apiBackendUrl) =>
		Effect.gen(function* () {
			const fallback: SetupRouteTarget = { url: apiBackendUrl, servedBySetup: false };
			const file = PlatformPaths.setupConfigFile(env.get("TRAEFIK_CONFIG_BASE_PATH"));
			const content = yield* Effect.tryPromise({ try: () => readFile(file, "utf8"), catch: (cause) => cause }).pipe(
				Effect.catch(() => Effect.succeed(null)),
			);
			if (content === null) return fallback;
			const url = /url:\s*"?([^"\s]+)"?/.exec(content)?.[1];
			if (url === undefined) return fallback;
			return new URL(url).pathname.startsWith(SETUP_DONE_PATH) ? fallback : { url, servedBySetup: true };
		});

	const managedWebPublicHosts = Effect.gen(function* () {
		const hosts: string[] = [];
		const origin = yield* platformConfig.getManagedWebOrigin();
		if (origin !== null) hosts.push(origin);
		const tunnel = yield* platformConfig.getManagedWebTunnel();
		if (tunnel !== null) hosts.push(tunnel.hostname);
		return [...new Set(hosts)];
	});

	/** DB-driven routes: global address, deployments, previews. Empty before the global DB exists. */
	const domainRoutes = (apiBackendUrl: string, services: Record<string, string>): Effect.Effect<LaneRoute[]> =>
		routesSource.listSupervisedRoutes().pipe(
			Effect.map((supervised: SupervisedRoute[]) =>
				supervised.map((route) => {
					const service = `${route.name}-svc`;
					services[service] = route.target.kind === "api" ? apiBackendUrl : `http://${route.target.name}:${String(route.target.port)}`;
					return { name: route.name, labels: route.label === null ? [] : [route.label], publicHosts: route.hosts, visibility: route.visibility, service };
				}),
			),
			Effect.catch((error) => Effect.logDebug(`Domain routes deferred — global DB not ready (${error.message})`).pipe(Effect.as([] as LaneRoute[]))),
		);

	/** Per-service domains registered in the traefik tables, skipping hosts already routed. */
	const serviceConfigRoutes = (claimed: ReadonlySet<string>, services: Record<string, string>): Effect.Effect<LaneRoute[]> =>
		Effect.gen(function* () {
			const configs = yield* traefikRepository.getAllServiceConfigs(true).pipe(Effect.catch(() => Effect.succeed([])));
			const routes: LaneRoute[] = [];
			const seen = new Set([...claimed].map((host) => host.toLowerCase()));
			for (const config of configs) {
				const host = extractHost(config.fullDomain);
				if (host === null || config.port < 1 || seen.has(host.toLowerCase())) continue;
				seen.add(host.toLowerCase());
				const targets = yield* traefikRepository.getServiceTargetsByConfigId(config.id, true).pipe(Effect.catch(() => Effect.succeed([])));
				const active = (targets as { url?: string | null; isActive?: boolean | null }[]).find((t) => t.isActive !== false && Boolean(t.url));
				const name = `svc-${config.id.slice(0, 8)}`;
				services[`${name}-svc`] = active?.url ?? `http://${host}:${String(config.port)}`;
				const visibility: RouteVisibility = "public";
				routes.push({ name, labels: [], publicHosts: [host], visibility, service: `${name}-svc` });
			}
			return routes;
		});

	return {
		setupRouteTarget,
		buildDynamicConfig: () =>
			Effect.gen(function* () {
				// The lanes are the one thing without a safe default here: no lanes, no configuration to serve.
				const current = yield* lanes.getLanes();
				const apiUrl = yield* apiBackend;
				const consoleVisibility = current.consoleVisibility;

				const routes: LaneRoute[] = [];
				const services: Record<string, string> = { [SERVICES.api]: apiUrl };
				const middlewares: Record<string, unknown> = {};

				routes.push({ name: "platform-api", labels: ["api"], visibility: consoleVisibility, service: SERVICES.api });

				// The managed web app's own public surface (custom origin, dedicated tunnel hostname) is reachable on the public lane only.
				const extraWebHosts = yield* managedWebPublicHosts;
				const web = yield* webTarget.resolveWebTarget();
				const webBackend = web === null ? null : `http://${web}:${String(PLATFORM_WEB_INTERNAL_PORT)}`;
				if (webBackend !== null) {
					services[SERVICES.web] = webBackend;
					routes.push({ name: "platform-web", labels: ["web"], publicHosts: extraWebHosts, visibility: consoleVisibility, service: SERVICES.web });
				}

				// One console URL, two visuals: the web app when it runs, the API's HTML console when it does not.
				services[SERVICES.console] = webBackend ?? apiUrl;
				routes.push({
					name: "platform-web-console",
					labels: ["api", "web"],
					publicHosts: extraWebHosts,
					visibility: consoleVisibility,
					service: SERVICES.console,
					ruleSuffix: `&& PathPrefix(\`${PLATFORM_WEB_CONSOLE_PATH}\`)`,
					priority: PRIORITY.console,
				});

				const setup = yield* setupRouteTarget(apiUrl);
				services[SERVICES.setup] = setup.url;
				if (setup.servedBySetup) {
					// Mid-handover: the wizard still owns its hostname, unchanged.
					routes.push({ name: "platform-setup", labels: ["setup"], visibility: consoleVisibility, service: SERVICES.setup, priority: PRIORITY.setup });
				} else {
					// After onboarding: a RELOAD of the wizard URL goes to the console, while the done page itself still renders.
					//
					// The redirect MUST cross hosts: a bare path would be resolved by the browser against `setup.<host>`, which does not
					// serve the console (a 401). Naming the API origin makes it an absolute redirect onto the host that serves it.
					middlewares[SETUP_REDIRECT_MIDDLEWARE] = {
						redirectRegex: {
							regex: "^https?://[^/]+/?$",
							replacement: `${hostnames.apiOrigin()}${PLATFORM_WEB_CONSOLE_PATH}`,
							permanent: true,
						},
					};
					routes.push({
						name: "platform-setup-redirect",
						labels: ["setup"],
						visibility: consoleVisibility,
						service: SERVICES.setup,
						ruleSuffix: `&& !PathPrefix(\`${SETUP_DONE_PATH}\`)`,
						middlewares: [SETUP_REDIRECT_MIDDLEWARE],
						priority: PRIORITY.setupRedirect,
					});
					routes.push({ name: "platform-setup", labels: ["setup"], visibility: consoleVisibility, service: SERVICES.setup, priority: PRIORITY.setup });
				}

				const claimed = new Set<string>([...extraWebHosts]);
				for (const route of yield* domainRoutes(apiUrl, services)) {
					routes.push(route);
					for (const host of route.publicHosts ?? []) claimed.add(host);
				}
				for (const route of yield* serviceConfigRoutes(claimed, services)) routes.push(route);

				return buildLaneTraefikConfig({
					lanes: current,
					domains: { local: hostnames.localDomain(), private: current.private.domain, public: current.public?.domain ?? null },
					routes,
					services,
					middlewares,
					tlsResolver: TRAEFIK_ACME_RESOLVER,
					publicAcme: edges.ingressPlan(current).tls === "acme",
				});
			}),
	};
}

export class TraefikIngressConfigService extends Context.Service<TraefikIngressConfigService, TraefikIngressConfigServiceShape>()(
	"shared/TraefikIngressConfigService",
) {}

/** Accept a bare host or a `Host(...)` rule back into a host. */
function extractHost(fullDomain: string | null | undefined): string | null {
	if (fullDomain === undefined || fullDomain === null || fullDomain.trim() === "") return null;
	if (fullDomain.includes("`")) return /^Host\(`([^`]+)`\)$/.exec(fullDomain.trim())?.[1] ?? null;
	try {
		return new URL(fullDomain.includes("://") ? fullDomain : `http://${fullDomain}`).hostname || null;
	} catch {
		return null;
	}
}
