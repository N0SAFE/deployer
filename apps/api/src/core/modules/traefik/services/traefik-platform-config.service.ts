/**
 * TraefikPlatformConfigService — the CORE traefik module's config-update
 * handler for the LIVE platform instance.
 *
 * Ownership model (per operator decision):
 *   - The traefik CORE module handles ALL configuration updates in the
 *     running Traefik instance. This service is that handler: it (re)writes
 *     the dynamic files the live file provider watches, on every config
 *     change AND at boot.
 *   - The Traefik SUPERVISOR only ensures the PROCESS (container, network,
 *     volume, entry port, liveness). It never writes config.
 *
 * One file PER OWNER at the watched volume root (`TRAEFIK_CONFIG_BASE_PATH`,
 * mounted at /config inside Traefik — non-recursive file provider):
 *
 *   | file                 | content                                              |
 *   |----------------------|------------------------------------------------------|
 *   | dynamic-api.yml      | api.<prefix>deployer.localhost → this API            |
 *   | dynamic-web.yml      | web.<prefix>deployer.localhost → the web container   |
 *   |                      | + the managed-web CONSOLE single-URL rule            |
 *   |                      |   (Host(api|web|extras) && PathPrefix(/manage/web-app)|
 *   |                      |   → web when enabled, → API HTML console when stopped)|
 *   | dynamic-domain.yml   | DB-driven platform routes (global hostname/tunnel,   |
 *   |                      | deployments, previews — PlatformRoutesSource)        |
 *   | dynamic-services.yml | per-SERVICE configs from the traefik DB tables       |
 *   |                      | (traefik_service_configs + domain routes + targets)  |
 *
 * Empty families remove their file so Traefik drops the rules
 * (`watch=true` picks up deletions). Each write is best-effort — a failing
 * family (e.g. the DB tables not migrated yet at early boot) logs + skips
 * instead of breaking the whole sync.
 */

import { Injectable, Logger } from "@nestjs/common";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { HostnameService } from "../../platform-ingress/services/hostname.service";
import { PlatformRouteConfigService } from "../../platform-ingress/services/platform-route-config.service";
import { PlatformPaths } from "../../platform-ingress/services/platform-paths";
import { PlatformWebTargetService } from "../../platform-ingress/services/platform-web-target.service";
import { PlatformRoutesSource } from "../../platform-ingress/services/platform-routes-source.service";
import { PlatformConfigService } from "../../platform-ingress/services/platform-config.service";
import { resolveSelfContainerName } from "../../platform-ingress/services/platform-self-resolver";
import { PLATFORM_WEB_INTERNAL_PORT } from "../../platform-ingress/services/platform-names";
import { TraefikRepository } from "../repositories/traefik.repository";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import { EnvService } from "@/config/env/env.service";

@Injectable()
export class TraefikPlatformConfigService {
	private readonly logger = new Logger(TraefikPlatformConfigService.name);

	constructor(
		private readonly env: EnvService,
		private readonly dockerService: DockerService,
		private readonly hostnameService: HostnameService,
		private readonly routeConfig: PlatformRouteConfigService,
		private readonly webTarget: PlatformWebTargetService,
		private readonly routesSource: PlatformRoutesSource,
		private readonly traefikRepository: TraefikRepository,
		private readonly platformConfig: PlatformConfigService,
	) {}

	/** Directory the live Traefik file provider watches. */
	configDir(): string {
		return this.env.get("TRAEFIK_CONFIG_BASE_PATH") ?? "/app/traefik-configs";
	}

	/**
	 * Rewrite ALL dynamic config files for the live instance. Idempotent.
	 * Family failures are isolated (logged + skipped) — a missing DB table at
	 * early boot must never stop the platform routes.
	 *
	 * Single-publish guarantee: every Host rule is emitted by exactly ONE
	 * file. The DB-driven platform routes (global hostname / tunnel /
	 * deployments / previews) are the authoritative owner of deployment
	 * hosts; per-service configs skip any host the domain file already
	 * claims — the same deployment Host can NEVER appear in both
	 * dynamic-domain.yml and dynamic-services.yml.
	 */
	async writePlatformConfigs(): Promise<void> {
		const dir = this.configDir();
		await mkdir(dir, { recursive: true });

		const domainRoutes = await this.resolveDomainRoutes();
		const claimedHosts = domainRoutes.flatMap((route) => route.hosts);

		await Promise.all([
			this.writeApiConfig(dir),
			this.writeWebConfig(dir),
			this.writeDomainConfig(dir, domainRoutes),
			this.writeServiceConfigs(dir, claimedHosts),
		]);
	}

	// ─── Platform api route ──────────────────────────────────────────────────

	private async writeApiConfig(dir: string): Promise<void> {
		const apiPort = String(this.env.get("API_PORT"));
		const backend = `http://${await resolveSelfContainerName(this.dockerService.getDockerClient(), this.env)}:${apiPort}`;
		const file = PlatformPaths.apiConfigFile(dir);
		await writeFile(file, this.routeConfig.buildApiYaml(backend, this.hostnameService.apiHostname()), "utf8");
	}

	// ─── Platform web route + managed-web CONSOLE single-URL rule ──────────

	private async writeWebConfig(dir: string): Promise<void> {
		const file = PlatformPaths.webConfigFile(dir);
		const webTarget = await this.webTarget.resolveWebTarget();

		// The managed web app's OWN public surface (custom domain/IP origin +
		// dedicated tunnel hostname) also terminates at Traefik — all of these
		// hosts route to the web backend. Traefik is the single entry point:
		// the web app never shares the node's global address.
		const extraHosts: string[] = [];
		const origin = await this.platformConfig.getManagedWebOrigin();
		if (origin !== null) extraHosts.push(origin);
		const tunnel = await this.platformConfig.getManagedWebTunnel();
		if (tunnel !== null) extraHosts.push(tunnel.hostname);

		// Single-publish guarantee: a host the DB-driven domain family already
		// claims (global address/tunnel/deployment/preview) must NEVER also
		// appear in dynamic-web.yml. The web app's own origin/tunnel is dropped
		// if it collides with a claimed host (the domain file wins — it is the
		// authoritative owner and dedupes first-wins).
		if (extraHosts.length > 0) {
			const claimed = new Set<string>(
				(await this.routesSource.listSupervisedRoutes()).flatMap((r) => r.hosts),
			);
			const unique = [...new Set(extraHosts)];
			for (const host of unique) {
				if (!claimed.has(host)) continue;
				this.logger.warn(
					`Web origin host "${host}" is already claimed by the platform domain routes (global/deployment/preview) — skipped in dynamic-web.yml`,
				);
			}
			extraHosts.length = 0;
			extraHosts.push(...unique.filter((host) => !claimed.has(host)));
		}

		// API backend: the CONSOLE fallback when the web is not running. The
		// single console URL `/manage/web-app` then resolves to the API HTML
		// console instead of the beautiful web page.
		const apiPort = String(this.env.get("API_PORT"));
		const apiBackend = `http://${await resolveSelfContainerName(this.dockerService.getDockerClient(), this.env)}:${apiPort}`;

		const webBackend =
			webTarget === null ? null : `http://${webTarget}:${String(PLATFORM_WEB_INTERNAL_PORT)}`;
		const consoleBackend = webBackend ?? apiBackend;

		// Console hosts: the platform's OWN surfaces only (API hostname +
		// web hostname + the web app's custom origin/tunnel) — deployment
		// hostnames never get the console rule.
		const consoleHosts = [
			this.hostnameService.apiHostname(),
			this.hostnameService.webHostname(),
			...extraHosts,
		];

		// ONE YAML document: both the web router AND the console router share
		// the same `http:` root — Traefik's file provider rejects a file with
		// two top-level `http:` keys (mapping key already defined), which
		// silently dropped the whole `dynamic-web.yml` family.
		const content = this.routeConfig.buildWebFamilyYaml({
			webBackendUrl: webBackend,
			webHostname: this.hostnameService.webHostname(),
			extraHostnames: extraHosts,
			consoleBackendUrl: consoleBackend,
			consoleHosts,
		});

		await writeFile(file, content, "utf8");
	}

	// ─── DB-driven platform routes (global hostname / tunnel / deployments /
	// ─── previews) ──────────────────────────────────────────────────────────

	private async resolveDomainRoutes(): Promise<
		Array<{ name: string; hosts: string[]; backendUrl: string }>
	> {
		let routes;
		try {
			routes = await this.routesSource.listSupervisedRoutes();
		} catch (error) {
			// The global database does not exist yet (FIRST BOOT / setup
			// phase). The domain family (global hostname / tunnel /
			// deployments / previews) is DB-driven, so it is skipped — but
			// api + web routes are still published, keeping
			// api.<host> / web.<host> reachable while the setup wizard runs.
			this.logger.log(
				"ℹ️  Platform domain routes deferred — global DB not ready yet (first-boot / setup phase)",
			);
			this.logger.debug(
				`Domain routes skipped: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		}
		if (routes.length === 0) {
			return [];
		}
		return Promise.all(
			routes.map(async (route) => ({
				name: route.name,
				hosts: route.hosts,
				backendUrl:
					route.target.kind === "api"
						? `http://${await resolveSelfContainerName(this.dockerService.getDockerClient(), this.env)}:${String(this.env.get("API_PORT"))}`
						: `http://${route.target.name}:${String(route.target.port)}`,
			})),
		);
	}

	private async writeDomainConfig(
		dir: string,
		routes: Array<{ name: string; hosts: string[]; backendUrl: string }>,
	): Promise<void> {
		const file = PlatformPaths.domainConfigFile(dir);
		if (routes.length === 0) {
			await rm(file, { force: true }).catch(() => undefined);
			return;
		}
		await writeFile(file, this.routeConfig.buildDomainRoutesYaml(routes), "utf8");
	}

	// ─── Per-SERVICE configs from the traefik DB (domain registration UI) ───
	// Hosts already published by the domain file (deployments/previews from
	// the live platform state) are skipped — single-publish, no duplicate
	// Host() rules across files.

	private async writeServiceConfigs(dir: string, claimedHosts: string[]): Promise<void> {
		const file = path.join(dir, "dynamic-services.yml");
		try {
			const configs = await this.traefikRepository.getAllServiceConfigs(true);
			const routes: Array<{ name: string; hosts: string[]; backendUrl: string }> = [];
			const claimed = new Set(claimedHosts.map((host) => host.toLowerCase()));

			for (const config of configs) {
				const rawFull = config.fullDomain;
				if (!rawFull || rawFull.trim() === "" || (config.port ?? 0) < 1) continue;
				const host = this.extractHostFromRule(rawFull);
				if (host === null) continue;
				if (claimed.has(host.toLowerCase())) continue;

				// Backend: first ACTIVE target's URL, else container:port guess.
				const targets = await this.traefikRepository.getServiceTargetsByConfigId(config.id, true).catch(() => []);
				const activeTarget = (targets as Array<{ url?: string | null; isActive?: boolean | null }>).find(
					(t) => t.isActive !== false && !!t?.url,
				);
				const backendUrl = activeTarget?.url ?? `http://${host.replace(/^([^.]+)/, "$1")}:${String(config.port)}`;

				routes.push({
					name: `svc-${String(config.id).slice(0, 8)}`,
					hosts: [host],
					backendUrl,
				});
			}

			if (routes.length === 0) {
				await rm(file, { force: true }).catch(() => undefined);
				return;
			}
			await writeFile(file, this.routeConfig.buildDomainRoutesYaml(routes), "utf8");
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.logger.log(
				"ℹ️  Per-service Traefik configs deferred — global DB not ready yet (first-boot / setup phase)",
			);
			this.logger.debug(`Per-service config sync skipped: ${msg}`);
			await rm(file, { force: true }).catch(() => undefined);
		}
	}

	/** Accept a bare host or an existing `Host(...)` rule back into a host. */
	private extractHostFromRule(fullDomain: string | undefined | null): string | null {
		if (fullDomain === undefined || fullDomain === null) return null;
		if (fullDomain.includes("`")) {
			const match = /^Host\(`([^`]+)`\)$/.exec(fullDomain.trim());
				if (match !== null) return match[1] ?? null;
			return null;
		}
		try {
			return new URL(fullDomain.includes("://") ? fullDomain : `http://${fullDomain}`).hostname || null;
		} catch {
			return null;
		}
	}
}