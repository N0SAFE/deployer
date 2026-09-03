/**
 * PlatformManagedWebService — the SINGLE shared implementation behind the
 * managed web app console. Both visuals of the one console URL
 * (`/manage/web-app`) delegate here:
 *
 *   - the API HTML console (PlatformConsoleController — the FALLBACK visual,
 *     served by Traefik when the web app is stopped),
 *   - the beautiful web page (ORPC ops — the visual served when the web app
 *     is running).
 *
 * Everything public terminates at the platform Traefik; the web app's OWN
 * surface (custom origin + dedicated tunnel) is routed to the web container
 * by Traefik, and this service is what makes that state converge (Traefik
 * config refresh + managed-web container reconcile).
 */

import { Injectable, Logger } from "@nestjs/common";

import { EnvService } from "@/config/env/env.service";
import { HostnameService } from "@/core/modules/platform-ingress/services/hostname.service";
import { PlatformConfigService } from "@/core/modules/platform-ingress/services/platform-config.service";
import { platformTraefikContainerName } from "@/core/modules/platform-ingress/services/platform-names";
import { SupervisorOrchestratorService } from "@/core/modules/supervisors/supervisor-orchestrator.service";
import { ManagedWebSupervisorService } from "@/core/modules/supervisors/platform/managed-web-supervisor.service";
import { TraefikConfigRefresher } from "@/core/modules/traefik/services/traefik-config-refresher.service";
import { CloudflareAppService } from "@/modules/providers/dns/cloudflare/services/cloudflare-app.service";
import { CloudflareTunnelService } from "@/modules/providers/dns/cloudflare/services/cloudflare-tunnel.service";
import type { ManagedWebState } from "@repo/api-contracts";

/** Identifier of the managed-web supervisor — referenced via the class
 *  static so it can never drift from the registered instance. */
const CONSOLE_SUPERVISOR_ID = ManagedWebSupervisorService.getIdentifier();

@Injectable()
export class PlatformManagedWebService {
	private readonly logger = new Logger(PlatformManagedWebService.name);

	constructor(
		private readonly env: EnvService,
		private readonly hostnameService: HostnameService,
		private readonly platformConfig: PlatformConfigService,
		private readonly orchestrator: SupervisorOrchestratorService,
		private readonly tunnelService: CloudflareTunnelService,
		private readonly cloudflareApps: CloudflareAppService,
		private readonly ingressRefresher: TraefikConfigRefresher,
	) {}

	/** Full console state — the shared data model of both visuals. */
	async state(): Promise<ManagedWebState> {
		const supervisor = this.orchestrator
			.list()
			.find((s) => s.supervisorId === CONSOLE_SUPERVISOR_ID);
		const snapshot = supervisor?.getStateSnapshot() ?? null;
		const health = supervisor !== undefined ? await supervisor.getHealth() : null;

		return {
			enabled: await this.platformConfig.isManagedWebAppEnabled(),
			external: Boolean(this.env.get("MANAGED_WEB_APP_EXTERNAL")),
			webHostname: this.hostnameService.webHostname(),
			customOrigin: await this.platformConfig.getManagedWebOrigin(),
			tunnel: await this.platformConfig.getManagedWebTunnel(),
			supervisorState: snapshot?.state ?? null,
			healthy: health?.healthy ?? null,
			detail: health?.detail ?? null,
		};
	}

	/** Flip the flag and converge — Traefik re-writes the console route so the
	 *  single URL switches visual (web page ↔ API console). */
	async toggle(): Promise<ManagedWebState> {
		const current = await this.platformConfig.isManagedWebAppEnabled();
		await this.platformConfig.setManagedWebAppEnabled(!current);
		await this.converge();
		return await this.state();
	}

	/** Force a restart (also records enabled). */
	async restart(): Promise<ManagedWebState> {
		await this.platformConfig.setManagedWebAppEnabled(true);
		await this.converge();
		return await this.state();
	}

	/** Set (or clear with null) the custom public origin. */
	async setOrigin(origin: string | null): Promise<ManagedWebState> {
		await this.platformConfig.setManagedWebOrigin(origin);
		await this.converge();
		this.logger.log(
			`Managed web origin set to ${origin === null ? "<platform default>" : origin}`,
		);
		return await this.state();
	}

	/**
	 * Provision the web app's OWN Cloudflare tunnel: create tunnel + CNAME on
	 * the provider, point its ingress at the platform TRAEFIK (web:80) —
	 * Traefik routes `Host(hostname) → web` — persist the identity and
	 * restart the app so its public origin becomes the tunnel hostname.
	 */
	async enableTunnel(hostname: string): Promise<ManagedWebState> {
		const provider = await this.resolveTunnelProvider();
		const name = `deployer-web-${hostname
			.replace(/[^a-z0-9]+/gi, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 32)}`;
		const created = await this.tunnelService.createTunnel(provider.providerId, {
			name,
			hostname,
		});
		const tunnelHostname = created.hostname;
		if (tunnelHostname === null) {
			// No zone matched → no CNAME. Roll back the freshly created tunnel.
			await this.tunnelService
				.deleteTunnel(provider.providerId, created.tunnel.id)
				.catch(() => undefined);
			throw new Error(
				`could not resolve "${hostname}" to a zone on the Cloudflare account — the tunnel was rolled back`,
			);
		}

		// Ingress → the platform TRAEFIK (web:80): cloudflared delivers to
		// Traefik, which routes the hostname to the web container.
		const service =
			process.env.CLOUDFLARE_TUNNEL_SERVICE_URL?.trim() ||
			`http://${platformTraefikContainerName(process.env.DEPLOYER_PREFIX)}:80`;
		try {
			await this.tunnelService.configureIngress(
				provider.providerId,
				created.tunnel.id,
				tunnelHostname,
				service,
			);
		} catch (err) {
			// Ingress is what makes the tunnel usable — roll the whole thing
			// back and surface the failure.
			await this.tunnelService
				.deleteTunnel(provider.providerId, created.tunnel.id, {
					hostname: tunnelHostname,
				})
				.catch(() => undefined);
			throw new Error(
				`ingress configuration failed (${err instanceof Error ? err.message : String(err)}) — tunnel rolled back`,
			);
		}

		await this.platformConfig.setManagedWebTunnel({
			tunnelId: created.tunnel.id,
			hostname: tunnelHostname,
			providerId: provider.providerId,
		});
		await this.converge();
		this.logger.log(`Managed web tunnel provisioned: ${tunnelHostname} → ${service}`);
		return await this.state();
	}

	/** Remove the web tunnel: delete tunnel + CNAME and restart the app. */
	async disableTunnel(): Promise<ManagedWebState> {
		const tunnel = await this.platformConfig.getManagedWebTunnel();
		if (tunnel !== null) {
			try {
				await this.tunnelService.deleteTunnel(tunnel.providerId, tunnel.tunnelId, {
					hostname: tunnel.hostname,
				});
			} catch (err) {
				this.logger.warn(
					`Web tunnel removal best-effort failed (${tunnel.tunnelId}): ${err instanceof Error ? err.message : String(err)}`,
				);
			}
			await this.platformConfig.clearManagedWebTunnel();
			await this.converge();
			this.logger.log(`Managed web tunnel removed: ${tunnel.hostname}`);
		}
		return await this.state();
	}

	/**
	 * Pick the Cloudflare app that owns tunnel creation. Explicit env override
	 * wins; otherwise the first tunnel-capable Cloudflare app (same surface as
	 * the node's global tunnel flow).
	 */
	private async resolveTunnelProvider(): Promise<{ providerId: string }> {
		const explicit = process.env.CLOUDFLARE_WEB_TUNNEL_PROVIDER_ID?.trim();
		if (explicit !== undefined && explicit !== "") return { providerId: explicit };

		const apps = await this.cloudflareApps.listTunnelCapableApps();
		const first = apps[0];
		if (first === undefined) {
			throw new Error(
				"no Cloudflare app is configured for tunnels — add one in Providers → DNS → Cloudflare first",
			);
		}
		return { providerId: first.id };
	}

	/** Converge after a config change: refresh live Traefik routes + reconcile
	 *  the managed web container (env with the new origin/allowlist). */
	private async converge(): Promise<void> {
		this.ingressRefresher.refresh();
		const supervisor = this.orchestrator
			.list()
			.find((s) => s.supervisorId === CONSOLE_SUPERVISOR_ID);
		if (supervisor !== undefined) await supervisor.ensureDesiredState();
	}
}