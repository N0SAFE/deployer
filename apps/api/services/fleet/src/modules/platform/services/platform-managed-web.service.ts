import { ServiceUnavailableError } from "@deployer/errors";
import { type ManagedWebState } from "@deployer/fleet-contracts";
import type { SupervisorOrchestratorService } from "@deployer/shared/core/modules/supervision/index";
import type { EnvService } from "@deployer/shared/config/env/env.module";
import type { HostnameService } from "@deployer/shared/core/modules/platform-ingress/services/hostname.service";
import type { PlatformConfigService } from "@deployer/shared/core/modules/platform-ingress/services/platform-config.service";
import { platformTraefikContainerName } from "@deployer/shared/core/modules/platform-ingress/services/platform-names";
import { ManagedWebSupervisorService } from "@deployer/shared/core/modules/supervisors/platform/managed-web-supervisor.service";
import type { TraefikConfigRefresher } from "@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service";
import { Context, Effect, Layer } from "effect";

import { attempt } from "../../../core/effects";
import { FleetInvalid } from "../../../core/fleet.errors";
import type { CloudflareAppService } from "@/modules/providers/dns/cloudflare/services/cloudflare-app.service";
import type { CloudflareTunnelService } from "@/modules/providers/dns/cloudflare/services/cloudflare-tunnel.service";
import {
	CloudflareAppsPort,
	PlatformConfigPort,
	PlatformEnvPort,
	PlatformHostnamesPort,
	PlatformRefresherPort,
	SupervisorsPort,
	WebTunnelPort,
} from "../platform.ports";

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


/** Identifier of the managed-web supervisor — referenced via the class static so it can never drift
 *  from the registered instance. */
const CONSOLE_SUPERVISOR_ID = ManagedWebSupervisorService.getIdentifier();

/**
 * A use case fails with `FleetInvalid` of its own, a `ServiceUnavailableError` when the tunnel's
 * ingress cannot be configured (after rolling the tunnel back), or whatever a platform collaborator
 * refused with (left as thrown; `serve` lets it through for the host to translate).
 */
export type PlatformManagedWebServiceShape = {
	/** Full console state — the shared data model of both visuals. */
	readonly state: () => Effect.Effect<ManagedWebState, unknown>;
	/** Flip the flag and converge — Traefik re-writes the console route so the single URL switches visual. */
	readonly toggle: () => Effect.Effect<ManagedWebState, unknown>;
	/** Force a restart (also records enabled). */
	readonly restart: () => Effect.Effect<ManagedWebState, unknown>;
	/** Set (or clear with null) the custom public origin. */
	readonly setOrigin: (origin: string | null) => Effect.Effect<ManagedWebState, unknown>;
	/**
	 * Provision the web app's OWN Cloudflare tunnel: create tunnel + CNAME on the provider, point its
	 * ingress at the platform TRAEFIK (web:80) — Traefik routes `Host(hostname) → web` — persist the
	 * identity and restart the app so its public origin becomes the tunnel hostname.
	 */
	readonly enableTunnel: (hostname: string) => Effect.Effect<ManagedWebState, unknown>;
	/** Remove the web tunnel: delete tunnel + CNAME and restart the app. */
	readonly disableTunnel: () => Effect.Effect<ManagedWebState, unknown>;
};

type Ports = {
	readonly env: EnvService;
	readonly hostnameService: HostnameService;
	readonly platformConfig: PlatformConfigService;
	readonly orchestrator: SupervisorOrchestratorService;
	readonly tunnelService: CloudflareTunnelService;
	readonly cloudflareApps: CloudflareAppService;
	readonly ingressRefresher: TraefikConfigRefresher;
};

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class PlatformManagedWebService extends Context.Service<PlatformManagedWebService, PlatformManagedWebServiceShape>()(
	"fleet/PlatformManagedWebService",
) {
	static readonly Live: Layer.Layer<
		PlatformManagedWebService,
		never,
		| PlatformEnvPort
		| PlatformHostnamesPort
		| PlatformConfigPort
		| SupervisorsPort
		| WebTunnelPort
		| CloudflareAppsPort
		| PlatformRefresherPort
	> = Layer.effect(
		PlatformManagedWebService,
		Effect.gen(function* () {
			return makePlatformManagedWebService({
				env: yield* PlatformEnvPort,
				hostnameService: yield* PlatformHostnamesPort,
				platformConfig: yield* PlatformConfigPort,
				orchestrator: yield* SupervisorsPort,
				tunnelService: yield* WebTunnelPort,
				cloudflareApps: yield* CloudflareAppsPort,
				ingressRefresher: yield* PlatformRefresherPort,
			});
		}),
	);
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function makePlatformManagedWebService(ports: Ports): PlatformManagedWebServiceShape {
	const { env, hostnameService, platformConfig, orchestrator, tunnelService, cloudflareApps, ingressRefresher } = ports;

	const supervisor = () => orchestrator.list().find((s) => s.supervisorId === CONSOLE_SUPERVISOR_ID);

	const state = Effect.fn("PlatformManagedWebService.state")(function* () {
		const current = supervisor();
		const snapshot = current?.getStateSnapshot() ?? null;
		const health = current !== undefined ? yield* attempt(() => current.getHealth()) : null;

		return {
			enabled: yield* attempt(() => platformConfig.isManagedWebAppEnabled()),
			external: Boolean(env.get("MANAGED_WEB_APP_EXTERNAL")),
			webHostname: hostnameService.webHostname(),
			customOrigin: yield* attempt(() => platformConfig.getManagedWebOrigin()),
			tunnel: yield* attempt(() => platformConfig.getManagedWebTunnel()),
			supervisorState: snapshot?.state ?? null,
			healthy: health?.healthy ?? null,
			detail: health?.detail ?? null,
		} satisfies ManagedWebState;
	});

	/** Converge after a config change: refresh live Traefik routes + reconcile the managed web
	 *  container (env with the new origin/allowlist). */
	const converge = Effect.fn("PlatformManagedWebService.converge")(function* () {
		ingressRefresher.refresh();
		const current = supervisor();
		if (current !== undefined) yield* attempt(() => current.ensureDesiredState());
	});

	/**
	 * Pick the Cloudflare app that owns tunnel creation. Explicit env override wins; otherwise the
	 * first tunnel-capable Cloudflare app (same surface as the node's global tunnel flow).
	 */
	const resolveTunnelProvider = Effect.fn("PlatformManagedWebService.resolveTunnelProvider")(function* () {
		const explicit = process.env.CLOUDFLARE_WEB_TUNNEL_PROVIDER_ID?.trim();
		if (explicit !== undefined && explicit !== "") return { providerId: explicit };

		const apps = yield* attempt(() => cloudflareApps.listTunnelCapableApps());
		const first = apps[0];
		if (first === undefined) {
			return yield* new FleetInvalid({
				reason: "no Cloudflare app is configured for tunnels — add one in Providers → DNS → Cloudflare first",
			});
		}
		return { providerId: first.id };
	});

	/** Best-effort rollback of a tunnel that cannot be used: its failure is not worth reporting. */
	const rollbackTunnel = (providerId: string, tunnelId: string, options?: { hostname: string }) =>
		attempt(() => tunnelService.deleteTunnel(providerId, tunnelId, options)).pipe(Effect.ignore);

	return {
		state,

		toggle: Effect.fn("PlatformManagedWebService.toggle")(function* () {
			const current = yield* attempt(() => platformConfig.isManagedWebAppEnabled());
			yield* attempt(() => platformConfig.setManagedWebAppEnabled(!current));
			yield* converge();
			return yield* state();
		}),

		restart: Effect.fn("PlatformManagedWebService.restart")(function* () {
			yield* attempt(() => platformConfig.setManagedWebAppEnabled(true));
			yield* converge();
			return yield* state();
		}),

		setOrigin: Effect.fn("PlatformManagedWebService.setOrigin")(function* (origin) {
			yield* attempt(() => platformConfig.setManagedWebOrigin(origin));
			yield* converge();
			yield* Effect.logInfo(`Managed web origin set to ${origin === null ? "<platform default>" : origin}`);
			return yield* state();
		}),

		enableTunnel: Effect.fn("PlatformManagedWebService.enableTunnel")(function* (hostname) {
			const provider = yield* resolveTunnelProvider();
			const name = `deployer-web-${hostname
				.replace(/[^a-z0-9]+/gi, "-")
				.replace(/^-+|-+$/g, "")
				.slice(0, 32)}`;
			const created = yield* attempt(() => tunnelService.createTunnel(provider.providerId, { name, hostname }));
			const tunnelHostname = created.hostname;
			if (tunnelHostname === null) {
				// No zone matched → no CNAME. Roll back the freshly created tunnel.
				yield* rollbackTunnel(provider.providerId, created.tunnel.id);
				return yield* new FleetInvalid({
					reason: `could not resolve "${hostname}" to a zone on the Cloudflare account — the tunnel was rolled back`,
				});
			}

			// Ingress → the platform TRAEFIK (web:80): cloudflared delivers to Traefik, which routes the
			// hostname to the web container.
			const service =
				process.env.CLOUDFLARE_TUNNEL_SERVICE_URL?.trim() ||
				`http://${platformTraefikContainerName(process.env.DEPLOYER_PREFIX)}:80`;
			yield* attempt(() =>
				tunnelService.configureIngress(provider.providerId, created.tunnel.id, tunnelHostname, service),
			).pipe(
				Effect.catch((err) =>
					// Ingress is what makes the tunnel usable — roll the whole thing back and surface the failure.
					rollbackTunnel(provider.providerId, created.tunnel.id, { hostname: tunnelHostname }).pipe(
						Effect.andThen(
							Effect.fail(
								new ServiceUnavailableError(
									`ingress configuration failed (${describe(err)}) — tunnel rolled back`,
								),
							),
						),
					),
				),
			);

			yield* attempt(() =>
				platformConfig.setManagedWebTunnel({
					tunnelId: created.tunnel.id,
					hostname: tunnelHostname,
					providerId: provider.providerId,
				}),
			);
			yield* converge();
			yield* Effect.logInfo(`Managed web tunnel provisioned: ${tunnelHostname} → ${service}`);
			return yield* state();
		}),

		disableTunnel: Effect.fn("PlatformManagedWebService.disableTunnel")(function* () {
			const tunnel = yield* attempt(() => platformConfig.getManagedWebTunnel());
			if (tunnel !== null) {
				yield* attempt(() =>
					tunnelService.deleteTunnel(tunnel.providerId, tunnel.tunnelId, { hostname: tunnel.hostname }),
				).pipe(
					Effect.catch((err) =>
						Effect.logWarning(`Web tunnel removal best-effort failed (${tunnel.tunnelId}): ${describe(err)}`),
					),
				);
				yield* attempt(() => platformConfig.clearManagedWebTunnel());
				yield* converge();
				yield* Effect.logInfo(`Managed web tunnel removed: ${tunnel.hostname}`);
			}
			return yield* state();
		}),
	};
}
