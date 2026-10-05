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
export const PLATFORM_SETUP_ROUTER_NAME = "platform-setup";
export const PLATFORM_SETUP_SERVICE_NAME = "platform-setup-svc";

/**
 * The router that sends a RELOAD of the wizard's URL to the dashboard.
 *
 * Separate from `PLATFORM_SETUP_ROUTER_NAME` because the two match different
 * things and must be allowed to disagree: this one owns "everything except the
 * done page", the other owns the done page itself.
 */
export const PLATFORM_SETUP_REDIRECT_ROUTER_NAME = "platform-setup-redirect";

/** The redirect middleware that router references. */
export const PLATFORM_SETUP_REDIRECT_MIDDLEWARE_NAME = "platform-setup-redirect";

/**
 * The path the handover points this hostname at, and the ONE path exempt from
 * the redirect.
 *
 * Must match what setup's final step writes and what `SetupDoneController`
 * declares. A drift here would bounce the done page operators are meant to see.
 */
const DONE_PATH = "/setup/done";

/**
 * Priority of the onboarding router.
 *
 * Higher than the console rule (2000) and the web family, because
 * `setup.<host>` is a DEDICATED hostname: nothing else may claim it, and the
 * router must win even if a future rule grows to overlap it. Setup used the
 * same value when it owned the file, so the takeover is priority-stable.
 */
const PLATFORM_SETUP_PRIORITY = 3000;

/**
 * Beats `PLATFORM_SETUP_PRIORITY`, so the redirect wins on the paths it claims.
 *
 * Both routers match `Host(<setup host>)`, and Traefik picks by priority before
 * rule length — so without this the plain router would serve the root path and
 * the redirect would never fire.
 */
const PLATFORM_SETUP_REDIRECT_PRIORITY = PLATFORM_SETUP_PRIORITY + 100;

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
	 * Onboarding route: Host(<setup hostname>) → the API's own landing page.
	 *
	 * ── WHY THE API OWNS THIS AFTER SETUP EXITS ─────────────────────────────
	 * `setup.<host>` is the URL in the operator's address bar when onboarding
	 * finishes. The setup app is the ONLY process that can serve it during
	 * onboarding — and the one process guaranteed to disappear at the end of it.
	 * Its exit leaves `dynamic-setup.yml` still naming `http://setup:3016`, a
	 * backend that no longer exists, so:
	 *
	 *   reload / bookmark / shared link  →  Bad Gateway (502)
	 *
	 * and nothing ever corrects it, because the file's writer has exited.
	 *
	 * Publishing the route HERE makes the hostname outlive its first owner: the
	 * API is already the process that survives setup, already writes the ingress
	 * config, and already serves the destination (`/setup/done`). `priority` is
	 * kept identical to setup's so the takeover is invisible to routing.
	 */
	buildSetupYaml(setupBackendUrl: string, setupHostname: string): string {
		const builder = new TraefikConfigBuilder();

		builder
			// ── THE ROOT OF THE SETUP HOST REDIRECTS, THE DONE PAGE DOES NOT ──────
			// `setup.<host>/` is the WIZARD's URL — the one in the operator's
			// address bar while onboarding ran, and therefore the one a RELOAD or a
			// bookmark reopens. Onboarding is over by the time this config is
			// written, so serving the done page there again makes a reload look
			// like the wizard restarted; the operator's intent is plainly "take me
			// to my platform".
			//
			// The longer path is excluded so the handover's OWN target still
			// renders: setup's final act points this hostname at `/setup/done`, and
			// a blanket redirect would bounce that page to the dashboard, losing
			// the "setup complete" acknowledgement the operator just earned.
			.addMiddleware(PLATFORM_SETUP_REDIRECT_MIDDLEWARE_NAME, (middleware) =>
				middleware.redirectRegex(
					// Matches the host root with no path (or a trailing slash only).
					`^https?://[^/]+/?$`,
					// Same-origin relative path: the console is served by the API on
					// every platform hostname, so no hostname has to be reconstructed
					// here and the redirect cannot point at a different site.
					PLATFORM_WEB_CONSOLE_PATH,
					true,
				),
			)
			.addRouter(PLATFORM_SETUP_REDIRECT_ROUTER_NAME, (router) =>
				router
					.rule(
						new RuleBuilder()
							.host(setupHostname)
							.and((rb) => rb.custom(`!PathPrefix(\`${DONE_PATH}\`)`)),
					)
					.middlewares(PLATFORM_SETUP_REDIRECT_MIDDLEWARE_NAME)
					.service(PLATFORM_SETUP_SERVICE_NAME)
					.entryPoints("web")
					.priority(PLATFORM_SETUP_REDIRECT_PRIORITY),
			)
			.addRouter(PLATFORM_SETUP_ROUTER_NAME, (router) =>
				router
					.rule(new RuleBuilder().host(setupHostname))
					.service(PLATFORM_SETUP_SERVICE_NAME)
					.entryPoints("web")
					.priority(PLATFORM_SETUP_PRIORITY),
			)
			.addService(PLATFORM_SETUP_SERVICE_NAME, (service) =>
				service.loadBalancer((lb) => lb.server(setupBackendUrl)),
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
