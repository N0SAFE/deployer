/**
 * PlatformRouteConfigService — generates the platform Traefik DYNAMIC routing
 * configs using the existing traefik config-builder (single source of truth
 * for Traefik config shapes in this codebase).
 *
 * One FILE PER OWNER inside the watched directory — no merge races between
 * supervisors:
 *   - dynamic-api.yml  ← owned by TraefikSupervisorService (API route)
 *   - dynamic-web.yml  ← owned by ManagedWebSupervisorService (web route)
 *
 * The docker provider stays enabled for label-based discovery of other
 * containers; everything platform-owned flows through these builder-generated
 * files.
 */

import { Injectable } from "@nestjs/common";
import { RuleBuilder, TraefikConfigBuilder } from "@/core/modules/traefik/config-builder/builders";

export const PLATFORM_API_ROUTER_NAME = "platform-api";
export const PLATFORM_API_SERVICE_NAME = "platform-api-svc";
export const PLATFORM_WEB_ROUTER_NAME = "platform-web";
export const PLATFORM_WEB_SERVICE_NAME = "platform-web-svc";
export const PLATFORM_WEB_CONSOLE_ROUTER_NAME = "platform-web-console";
export const PLATFORM_WEB_CONSOLE_SERVICE_NAME = "platform-web-console-svc";

/**
 * The single console URL of the managed web app. Traefik routes this path on
 * the platform's own hosts (API + web surfaces) to EITHER the beautiful web
 * page (web app enabled) OR the API HTML console (web app stopped) — one
 * URL, two visuals, selected by `managed_web_app.enabled` at write time.
 */
export const PLATFORM_WEB_CONSOLE_PATH = "/manage/web-app";

/** Explicit priority — always beats the Host-only platform/domain routers
 *  (rule-length precedence alone would also suffice; this makes the intent
 *  unmistakable and robust to future rule additions). */
const PLATFORM_WEB_CONSOLE_PRIORITY = 2000;

@Injectable()
export class PlatformRouteConfigService {
	/**
	 * API route: Host(<api hostname>) → API backend inside the platform network.
	 */
	buildApiYaml(apiBackendUrl: string, apiHostname: string): string {
		const builder = new TraefikConfigBuilder();

		builder
			.addRouter(PLATFORM_API_ROUTER_NAME, (router) =>
				router
					.rule(new RuleBuilder().host(apiHostname))
					.service(PLATFORM_API_SERVICE_NAME)
					.entryPoints("web"),
			)
			.addService(PLATFORM_API_SERVICE_NAME, (service) =>
				service.loadBalancer((lb) => lb.server(apiBackendUrl)),
			);

		return TraefikConfigBuilder.toYAMLString(builder.build());
	}

	/**
	 * The FULL WEB FAMILY in ONE YAML document (Traefik file provider rejects
	 * two `http:` roots in the same file — every router/service must share a
	 * single `<root>`):
	 *
	 *   1. `platform-web` — Host(<web hostname>) [+ custom origin/tunnel] →
	 *      the managed web container (skipped when `webBackendUrl` is null).
	 *   2. `platform-web-console` — the single-URL console rule
	 *      `(Host(api) || Host(web) || Host(extras)) && PathPrefix(/manage/web-app)`
	 *      → `consoleBackendUrl` (the WEB app when it is enabled — beautiful
	 *      page — or the API itself when it is stopped — HTML console), with
	 *      an explicit high `priority` so it wins over Host-only routers for
	 *      that path.
	 *
	 * Console hosts are the platform's OWN surfaces (API + web hostname +
	 * custom origin/tunnel) — deployment hostnames never get the console rule.
	 */
	buildWebFamilyYaml(opts: {
		webBackendUrl: string | null;
		webHostname: string;
		extraHostnames?: string[];
		consoleBackendUrl: string;
		consoleHosts: string[];
	}): string {
		const builder = new TraefikConfigBuilder();

		// 1) Web router (Host → web backend), optional.
		const webHosts = [opts.webHostname, ...(opts.extraHostnames ?? [])]
			.filter((host) => host.trim() !== "");
		if (opts.webBackendUrl !== null && webHosts.length > 0) {
			builder
				.addRouter(PLATFORM_WEB_ROUTER_NAME, (router) =>
					router
						.rule(webHosts.map((host) => `Host(\`${host}\`)`).join(" || "))
						.service(PLATFORM_WEB_SERVICE_NAME)
						.entryPoints("web"),
				)
				.addService(PLATFORM_WEB_SERVICE_NAME, (service) =>
					service.loadBalancer((lb) => lb.server(opts.webBackendUrl!)),
				);
		}

		// 2) Console router (same document!) — the two-visual single URL.
		const hosts = [...new Set(opts.consoleHosts)].filter((host) => host.trim() !== "");
		const rule = hosts.length === 0
			? `PathPrefix(\`${PLATFORM_WEB_CONSOLE_PATH}\`)`
			: `(${hosts.map((host) => `Host(\`${host}\`)`).join(" || ")}) && PathPrefix(\`${PLATFORM_WEB_CONSOLE_PATH}\`)`;

		builder
			.addRouter(PLATFORM_WEB_CONSOLE_ROUTER_NAME, (router) =>
				router
					.rule(rule)
					.service(PLATFORM_WEB_CONSOLE_SERVICE_NAME)
					.entryPoints("web")
					.priority(PLATFORM_WEB_CONSOLE_PRIORITY),
			)
			.addService(PLATFORM_WEB_CONSOLE_SERVICE_NAME, (service) =>
				service.loadBalancer((lb) => lb.server(opts.consoleBackendUrl)),
			);

		return TraefikConfigBuilder.toYAMLString(builder.build());
	}

	/**
	 * DB-driven DOMAIN routes (global hostname, tunnel, deployments, previews)
	 * — one router + service per route, already resolved to a concrete backend
	 * URL by the supervisor (the API target is resolved at write time).
	 */
	buildDomainRoutesYaml(routes: Array<{ name: string; hosts: string[]; backendUrl: string }>): string {
		const builder = new TraefikConfigBuilder();
		for (const route of routes) {
			const rule = route.hosts.map((host) => `Host(\`${host}\`)`).join(" || ");
			builder
				.addRouter(route.name, (router) =>
					router.rule(rule).service(`${route.name}-svc`).entryPoints("web"),
				)
				.addService(`${route.name}-svc`, (service) =>
					service.loadBalancer((lb) => lb.server(route.backendUrl)),
				);
		}
		return TraefikConfigBuilder.toYAMLString(builder.build());
	}
}
