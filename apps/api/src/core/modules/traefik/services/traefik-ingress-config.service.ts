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
import { Injectable, Logger } from "@nestjs/common";
import type { RouteVisibility } from "@deployer/contracts-entities/entities/ingress/index";
import { DockerService } from "@deployer/nest-docker/services/docker.service";

import { EnvService } from "@/config/env/env.module";
import { EdgeProviderRegistry } from "@/core/modules/edge/edge-provider.registry";
import { HostnameService } from "../../platform-ingress/services/hostname.service";
import { IngressLanesService } from "../../platform-ingress/services/ingress-lanes.service";
import {
	buildLaneTraefikConfig,
	TRAEFIK_ACME_RESOLVER,
	type LaneRoute,
	type LaneTraefikConfig,
} from "../../platform-ingress/services/lane-traefik-config";
import { PlatformConfigService } from "../../platform-ingress/services/platform-config.service";
import { PLATFORM_WEB_INTERNAL_PORT } from "../../platform-ingress/services/platform-names";
import { PlatformPaths } from "../../platform-ingress/services/platform-paths";
import { PlatformRoutesSource } from "../../platform-ingress/services/platform-routes-source.service";
import { type SupervisedRoute } from "../../platform-ingress/services/platform-routes-source.service";
import { resolveSelfContainerName } from "../../platform-ingress/services/platform-self-resolver";
import { PlatformWebTargetService } from "../../platform-ingress/services/platform-web-target.service";
import { TraefikRepository } from "../repositories/traefik.repository";

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
export interface SetupRouteTarget {
	url: string;
	/** True while setup's own wizard still serves the hostname (mid-handover). */
	servedBySetup: boolean;
}

@Injectable()
export class TraefikIngressConfigService {
	private readonly logger = new Logger(TraefikIngressConfigService.name);

	constructor(
		private readonly env: EnvService,
		private readonly dockerService: DockerService,
		private readonly hostnames: HostnameService,
		private readonly lanes: IngressLanesService,
		private readonly webTarget: PlatformWebTargetService,
		private readonly routesSource: PlatformRoutesSource,
		private readonly traefikRepository: TraefikRepository,
		private readonly platformConfig: PlatformConfigService,
		private readonly edges: EdgeProviderRegistry,
	) {}

	/** The API's own backend on the platform overlay. */
	private async apiBackend(): Promise<string> {
		return `http://${await resolveSelfContainerName(this.dockerService.getDockerClient(), this.env)}:${String(this.env.get("API_PORT"))}`;
	}

	async buildDynamicConfig(): Promise<LaneTraefikConfig> {
		const lanes = await this.lanes.getLanes();
		const apiBackend = await this.apiBackend();
		const console = lanes.consoleVisibility;

		const routes: LaneRoute[] = [];
		const services: Record<string, string> = { [SERVICES.api]: apiBackend };
		const middlewares: Record<string, unknown> = {};

		routes.push({ name: "platform-api", labels: ["api"], visibility: console, service: SERVICES.api });

		// The managed web app's own public surface (custom origin, dedicated tunnel
		// hostname) is reachable on the public lane only — they are public DNS names.
		const extraWebHosts = await this.managedWebPublicHosts();
		const webTarget = await this.webTarget.resolveWebTarget();
		const webBackend = webTarget === null ? null : `http://${webTarget}:${String(PLATFORM_WEB_INTERNAL_PORT)}`;
		if (webBackend !== null) {
			services[SERVICES.web] = webBackend;
			routes.push({ name: "platform-web", labels: ["web"], publicHosts: extraWebHosts, visibility: console, service: SERVICES.web });
		}

		// One console URL, two visuals: the web app when it runs, the API's HTML
		// console when it does not.
		services[SERVICES.console] = webBackend ?? apiBackend;
		routes.push({
			name: "platform-web-console",
			labels: ["api", "web"],
			publicHosts: extraWebHosts,
			visibility: console,
			service: SERVICES.console,
			ruleSuffix: `&& PathPrefix(\`${PLATFORM_WEB_CONSOLE_PATH}\`)`,
			priority: PRIORITY.console,
		});

		const setup = await this.setupRouteTarget(apiBackend);
		services[SERVICES.setup] = setup.url;
		if (setup.servedBySetup) {
			// Mid-handover: the wizard still owns its hostname, unchanged.
			routes.push({ name: "platform-setup", labels: ["setup"], visibility: console, service: SERVICES.setup, priority: PRIORITY.setup });
		} else {
			// After onboarding: a RELOAD of the wizard URL goes to the console, while
			// the done page itself still renders.
			middlewares[SETUP_REDIRECT_MIDDLEWARE] = {
				redirectRegex: { regex: "^https?://[^/]+/?$", replacement: PLATFORM_WEB_CONSOLE_PATH, permanent: true },
			};
			routes.push({
				name: "platform-setup-redirect",
				labels: ["setup"],
				visibility: console,
				service: SERVICES.setup,
				ruleSuffix: `&& !PathPrefix(\`${SETUP_DONE_PATH}\`)`,
				middlewares: [SETUP_REDIRECT_MIDDLEWARE],
				priority: PRIORITY.setupRedirect,
			});
			routes.push({ name: "platform-setup", labels: ["setup"], visibility: console, service: SERVICES.setup, priority: PRIORITY.setup });
		}

		const claimed = new Set<string>([...extraWebHosts]);
		for (const route of await this.domainRoutes(apiBackend, services)) {
			routes.push(route);
			for (const host of route.publicHosts ?? []) claimed.add(host);
		}
		for (const route of await this.serviceConfigRoutes(claimed, services)) routes.push(route);

		return buildLaneTraefikConfig({
			lanes,
			domains: {
				local: this.hostnames.localDomain(),
				private: lanes.private.domain,
				public: lanes.public?.domain ?? null,
			},
			routes,
			services,
			middlewares,
			tlsResolver: TRAEFIK_ACME_RESOLVER,
			publicAcme: this.edges.ingressPlan(lanes).tls === "acme",
		});
	}

	private async managedWebPublicHosts(): Promise<string[]> {
		const hosts: string[] = [];
		const origin = await this.platformConfig.getManagedWebOrigin().catch(() => null);
		if (origin !== null) hosts.push(origin);
		const tunnel = await this.platformConfig.getManagedWebTunnel().catch(() => null);
		if (tunnel !== null) hosts.push(tunnel.hostname);
		return [...new Set(hosts)];
	}

	/**
	 * Where `setup.<host>` points.
	 *
	 * Setup declares its hostname's backend in its handover file — the one contract
	 * between the two apps, in the config volume both mount. While that backend is
	 * not the API's done page, setup is still mid-handover and keeps its route; once
	 * it repoints at the done page (or the file is gone) the API owns the hostname.
	 */
	async setupRouteTarget(apiBackend: string): Promise<SetupRouteTarget> {
		const fallback: SetupRouteTarget = { url: apiBackend, servedBySetup: false };
		const file = PlatformPaths.setupConfigFile(this.env.get("TRAEFIK_CONFIG_BASE_PATH"));
		let content: string;
		try {
			content = await readFile(file, "utf8");
		} catch {
			return fallback;
		}
		const url = /url:\s*"?([^"\s]+)"?/.exec(content)?.[1];
		if (url === undefined) return fallback;
		return new URL(url).pathname.startsWith(SETUP_DONE_PATH) ? fallback : { url, servedBySetup: true };
	}

	/** DB-driven routes: global address, deployments, previews. Empty before the global DB exists. */
	private async domainRoutes(apiBackend: string, services: Record<string, string>): Promise<LaneRoute[]> {
		let supervised: SupervisedRoute[];
		try {
			supervised = await this.routesSource.listSupervisedRoutes();
		} catch (error) {
			this.logger.debug(`Domain routes deferred — global DB not ready (${error instanceof Error ? error.message : String(error)})`);
			return [];
		}
		return supervised.map((route) => {
			const service = `${route.name}-svc`;
			services[service] = route.target.kind === "api" ? apiBackend : `http://${route.target.name}:${String(route.target.port)}`;
			return { name: route.name, labels: route.label === null ? [] : [route.label], publicHosts: route.hosts, visibility: route.visibility, service };
		});
	}

	/** Per-service domains registered in the traefik tables, skipping hosts already routed. */
	private async serviceConfigRoutes(claimed: ReadonlySet<string>, services: Record<string, string>): Promise<LaneRoute[]> {
		let configs: Awaited<ReturnType<TraefikRepository["getAllServiceConfigs"]>>;
		try {
			configs = await this.traefikRepository.getAllServiceConfigs(true);
		} catch {
			return [];
		}
		const routes: LaneRoute[] = [];
		const seen = new Set([...claimed].map((host) => host.toLowerCase()));
		for (const config of configs) {
			const host = extractHost(config.fullDomain);
			if (host === null || config.port < 1 || seen.has(host.toLowerCase())) continue;
			seen.add(host.toLowerCase());
			const targets = await this.traefikRepository.getServiceTargetsByConfigId(config.id, true).catch(() => []);
			const active = (targets as { url?: string | null; isActive?: boolean | null }[]).find((t) => t.isActive !== false && Boolean(t.url));
			const name = `svc-${config.id.slice(0, 8)}`;
			services[`${name}-svc`] = active?.url ?? `http://${host}:${String(config.port)}`;
			const visibility: RouteVisibility = "public";
			routes.push({ name, labels: [], publicHosts: [host], visibility, service: `${name}-svc` });
		}
		return routes;
	}
}

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
