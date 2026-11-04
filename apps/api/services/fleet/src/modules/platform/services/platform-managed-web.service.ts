import { Context, Effect } from "effect";

import { bindServices, serviceOver, type Bound, type Over, type RequirementsOf } from "@deployer/effect-core";
import { ServiceUnavailableError } from "@deployer/errors";
import { type ManagedWebState } from "@deployer/fleet-contracts";
import { PLATFORM_MANAGED_WEB_SUPERVISOR_ID } from "@deployer/platform-supervisors";
import type { EnvService } from "@deployer/shared/config/env/env.module";
import type { HostnameService } from "@deployer/shared/core/modules/platform-ingress/services/hostname.service";
import type { PlatformConfigService } from "@deployer/shared/core/modules/platform-ingress/services/platform-config.service";
import { platformTraefikContainerName } from "@deployer/shared/core/modules/platform-ingress/services/platform-names";
import type { TraefikConfigRefresherShape } from "@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service";
import type { SupervisorOrchestratorShape } from "@deployer/supervision";

import { CloudflareAppService, type CloudflareAppServiceShape } from "@/modules/providers/dns/cloudflare/services/cloudflare-app.service";
import { CloudflareTunnelService, type CloudflareTunnelServiceShape } from "@/modules/providers/dns/cloudflare/services/cloudflare-tunnel.service";

import { attempt } from "../../../core/effects";
import { FleetInvalid } from "../../../core/fleet.errors";
import {
	PlatformConfigPort,
	PlatformEnvPort,
	PlatformHostnamesPort,
	PlatformRefresherPort,
	SupervisorsPort,
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
const CONSOLE_SUPERVISOR_ID = PLATFORM_MANAGED_WEB_SUPERVISOR_ID;

/**
 * A use case fails with `FleetInvalid` of its own, a `ServiceUnavailableError` when the tunnel's
 * ingress cannot be configured (after rolling the tunnel back), or whatever a platform collaborator
 * refused with (left as thrown; `serve` lets it through for the host to translate).
 */
export type PlatformManagedWebServiceShape = {
	/** Full console state — the shared data model of both visuals. */
	readonly state: () => Effect.Effect<ManagedWebState, unknown, PlatformManagedWebRequirements>;
	/** Flip the flag and converge — Traefik re-writes the console route so the single URL switches visual. */
	readonly toggle: () => Effect.Effect<ManagedWebState, unknown, PlatformManagedWebRequirements>;
	/** Force a restart (also records enabled). */
	readonly restart: () => Effect.Effect<ManagedWebState, unknown, PlatformManagedWebRequirements>;
	/** Set (or clear with null) the custom public origin. */
	readonly setOrigin: (origin: string | null) => Effect.Effect<ManagedWebState, unknown, PlatformManagedWebRequirements>;
	/**
	 * Provision the web app's OWN Cloudflare tunnel: create tunnel + CNAME on the provider, point its
	 * ingress at the platform TRAEFIK (web:80) — Traefik routes `Host(hostname) → web` — persist the
	 * identity and restart the app so its public origin becomes the tunnel hostname.
	 */
	readonly enableTunnel: (hostname: string) => Effect.Effect<ManagedWebState, unknown, PlatformManagedWebRequirements>;
	/** Remove the web tunnel: delete tunnel + CNAME and restart the app. */
	readonly disableTunnel: () => Effect.Effect<ManagedWebState, unknown, PlatformManagedWebRequirements>;
};

/** What the Cloudflare services leave open in the Effect context; settled once, when they are handed over. */
type CloudflareRequirements = RequirementsOf<CloudflareTunnelServiceShape> | RequirementsOf<CloudflareAppServiceShape>;
type SettledTunnels = Bound<CloudflareTunnelServiceShape, CloudflareRequirements>;
type SettledApps = Bound<CloudflareAppServiceShape, CloudflareRequirements>;

/** Everything a use case reads from the Effect context while it runs. */
type PlatformManagedWebRequirements =
	| PlatformEnvPort
	| PlatformHostnamesPort
	| PlatformConfigPort
	| SupervisorsPort
	| CloudflareTunnelService
	| CloudflareAppService
	| CloudflareRequirements
	| PlatformRefresherPort;

type Ports = {
	readonly env: EnvService;
	readonly hostnameService: HostnameService;
	readonly platformConfig: PlatformConfigService;
	readonly orchestrator: SupervisorOrchestratorShape;
	readonly tunnelService: SettledTunnels;
	readonly cloudflareApps: SettledApps;
	readonly ingressRefresher: TraefikConfigRefresherShape;
};

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class PlatformManagedWebService extends Context.Service<PlatformManagedWebService, Over<PlatformManagedWebServiceShape, PlatformManagedWebRequirements>>()(
	"fleet/PlatformManagedWebService",
) {
	/** The ports are yielded when a method runs, so this is a constant the module provides with `useValue`. */
	static readonly live = serviceOver(
		Effect.gen(function* () {
			// The Cloudflare services read their own collaborators from the context; hand them over with that settled.
			const settled = yield* Effect.context<CloudflareRequirements>();
			return {
				env: yield* PlatformEnvPort,
				hostnameService: yield* PlatformHostnamesPort,
				platformConfig: yield* PlatformConfigPort,
				orchestrator: yield* SupervisorsPort,
				tunnelService: bindServices(yield* CloudflareTunnelService, settled),
				cloudflareApps: bindServices(yield* CloudflareAppService, settled),
				ingressRefresher: yield* PlatformRefresherPort,
			};
		}),
		makePlatformManagedWebService,
	);

}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function makePlatformManagedWebService(ports: Ports): PlatformManagedWebServiceShape {
	const { env, hostnameService, platformConfig, orchestrator, tunnelService, cloudflareApps, ingressRefresher } = ports;

	const supervisor = () => orchestrator.list().find((s) => s.id === CONSOLE_SUPERVISOR_ID);

	const state = Effect.fn("PlatformManagedWebService.state")(function* () {
		const current = supervisor();
		const snapshot = current !== undefined ? yield* current.getStateSnapshot : null;
		const health = current !== undefined ? yield* current.getHealth : null;

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
		if (current !== undefined) yield* current.ensureDesiredState;
	});

	/**
	 * Pick the Cloudflare app that owns tunnel creation. Explicit env override wins; otherwise the
	 * first tunnel-capable Cloudflare app (same surface as the node's global tunnel flow).
	 */
	const resolveTunnelProvider = Effect.fn("PlatformManagedWebService.resolveTunnelProvider")(function* () {
		const explicit = process.env.CLOUDFLARE_WEB_TUNNEL_PROVIDER_ID?.trim();
		if (explicit !== undefined && explicit !== "") return { providerId: explicit };

		const apps = yield* cloudflareApps.listTunnelCapableApps();
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
		tunnelService.deleteTunnel(providerId, tunnelId, options).pipe(Effect.ignore);

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
			const created = yield* tunnelService.createTunnel(provider.providerId, { name, hostname });
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
			yield* tunnelService.configureIngress(provider.providerId, created.tunnel.id, tunnelHostname, service).pipe(
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
				yield* tunnelService.deleteTunnel(tunnel.providerId, tunnel.tunnelId, { hostname: tunnel.hostname }).pipe(
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
