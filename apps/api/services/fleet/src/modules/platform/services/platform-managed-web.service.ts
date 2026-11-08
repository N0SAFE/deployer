import { Context, Effect } from 'effect'

import {
    bindServices,
    type Bound,
    type RequirementsOf,
} from '@deployer/effect-core'
import { ServiceUnavailableError } from '@deployer/errors'
import { type ManagedWebState } from '@deployer/fleet-contracts'
import { PLATFORM_MANAGED_WEB_SUPERVISOR_ID } from '@deployer/platform-supervisors'
import { platformTraefikContainerName } from '@deployer/shared/core/modules/platform-ingress/services/platform-names'
import type { SupervisorOrchestratorShape } from '@deployer/supervision'

import {
    CloudflareAppService,
    type CloudflareAppServiceShape,
} from '@/modules/providers/dns/cloudflare/services/cloudflare-app.service'
import {
    CloudflareTunnelService,
    type CloudflareTunnelServiceShape,
} from '@/modules/providers/dns/cloudflare/services/cloudflare-tunnel.service'

import { FleetInvalid } from '../../../core/fleet.errors'
import {
    PlatformConfigPort,
    PlatformEnvPort,
    PlatformHostnamesPort,
    PlatformRefresherPort,
    SupervisorsPort,
} from '../platform.ports'

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
const CONSOLE_SUPERVISOR_ID = PLATFORM_MANAGED_WEB_SUPERVISOR_ID

/**
 * A use case fails with `FleetInvalid` of its own, a `ServiceUnavailableError` when the tunnel's
 * ingress cannot be configured (after rolling the tunnel back), or whatever a platform collaborator
 * refused with (left as thrown; the `.effect()` boundary lets it through for the host to translate).
 */
export type PlatformManagedWebServiceShape = {
    /** Full console state — the shared data model of both visuals. */
    readonly state: () => Effect.Effect<
        ManagedWebState,
        unknown,
        PlatformManagedWebRequirements
    >
    /** Flip the flag and converge — Traefik re-writes the console route so the single URL switches visual. */
    readonly toggle: () => Effect.Effect<
        ManagedWebState,
        unknown,
        PlatformManagedWebRequirements
    >
    /** Force a restart (also records enabled). */
    readonly restart: () => Effect.Effect<
        ManagedWebState,
        unknown,
        PlatformManagedWebRequirements
    >
    /** Set (or clear with null) the custom public origin. */
    readonly setOrigin: (
        origin: string | null
    ) => Effect.Effect<ManagedWebState, unknown, PlatformManagedWebRequirements>
    /**
     * Provision the web app's OWN Cloudflare tunnel: create tunnel + CNAME on the provider, point its
     * ingress at the platform TRAEFIK (web:80) — Traefik routes `Host(hostname) → web` — persist the
     * identity and restart the app so its public origin becomes the tunnel hostname.
     */
    readonly enableTunnel: (
        hostname: string
    ) => Effect.Effect<ManagedWebState, unknown, PlatformManagedWebRequirements>
    /** Remove the web tunnel: delete tunnel + CNAME and restart the app. */
    readonly disableTunnel: () => Effect.Effect<
        ManagedWebState,
        unknown,
        PlatformManagedWebRequirements
    >
}

/** What the Cloudflare services leave open in the Effect context; settled once, when they are handed over. */
type CloudflareRequirements =
    | RequirementsOf<CloudflareTunnelServiceShape>
    | RequirementsOf<CloudflareAppServiceShape>
type SettledTunnels = Bound<
    CloudflareTunnelServiceShape,
    CloudflareRequirements
>
type SettledApps = Bound<CloudflareAppServiceShape, CloudflareRequirements>

/** Everything a use case reads from the Effect context while it runs. */
type PlatformManagedWebRequirements =
    | PlatformEnvPort
    | PlatformHostnamesPort
    | PlatformConfigPort
    | SupervisorsPort
    | CloudflareTunnelService
    | CloudflareAppService
    | CloudflareRequirements
    | PlatformRefresherPort

/** One instance the supervisor orchestrator exposes. */
type SupervisorInstance = ReturnType<SupervisorOrchestratorShape['list']>[number]

const describe = (error: unknown) =>
    error instanceof Error ? error.message : String(error)

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class PlatformManagedWebService extends Context.Service<
    PlatformManagedWebService,
    PlatformManagedWebServiceShape
>()('fleet/PlatformManagedWebService') {
    static readonly live = class PlatformManagedWebServiceImpl
        implements PlatformManagedWebServiceShape
    {
        /** The managed-web supervisor, when the orchestrator has registered it. */
        private current(): Effect.Effect<
            SupervisorInstance | undefined,
            never,
            PlatformManagedWebRequirements
        > {
            return Effect.map(SupervisorsPort, (orchestrator) =>
                orchestrator.list().find((s) => s.id === CONSOLE_SUPERVISOR_ID)
            )
        }

        /**
         * The Cloudflare services read their own collaborators from the
         * context; hand them over with that settled so an operation sees a
         * service whose channel is closed.
         */
        private tunnels(): Effect.Effect<
            SettledTunnels,
            never,
            PlatformManagedWebRequirements
        > {
            return Effect.gen(function* () {
                const settled = yield* Effect.context<CloudflareRequirements>()
                return bindServices(yield* CloudflareTunnelService, settled)
            })
        }

        private apps(): Effect.Effect<
            SettledApps,
            never,
            PlatformManagedWebRequirements
        > {
            return Effect.gen(function* () {
                const settled = yield* Effect.context<CloudflareRequirements>()
                return bindServices(yield* CloudflareAppService, settled)
            })
        }

        /** Converge after a config change: refresh live Traefik routes + reconcile the managed web container. */
        private converge(): Effect.Effect<
            void,
            unknown,
            PlatformManagedWebRequirements
        > {
            return Effect.gen({ self: this }, function* () {
                const ingressRefresher = yield* PlatformRefresherPort
                ingressRefresher.refresh()
                const current = yield* this.current()
                if (current !== undefined) yield* current.ensureDesiredState
            })
        }

        /**
         * Pick the Cloudflare app that owns tunnel creation. Explicit env
         * override wins; otherwise the first tunnel-capable Cloudflare app
         * (same surface as the node's global tunnel flow).
         */
        private resolveTunnelProvider(): Effect.Effect<
            { providerId: string },
            unknown,
            PlatformManagedWebRequirements
        > {
            return Effect.gen({ self: this }, function* () {
                const explicit =
                    process.env.CLOUDFLARE_WEB_TUNNEL_PROVIDER_ID?.trim()
                if (explicit !== undefined && explicit !== '')
                    return { providerId: explicit }

                const cloudflareApps = yield* this.apps()
                const apps = yield* cloudflareApps.listTunnelCapableApps()
                const first = apps[0]
                if (first === undefined) {
                    return yield* new FleetInvalid({
                        reason: 'no Cloudflare app is configured for tunnels — add one in Providers → DNS → Cloudflare first',
                    })
                }
                return { providerId: first.id }
            })
        }

        /** Best-effort rollback of a tunnel that cannot be used: its failure is not worth reporting. */
        private rollback(
            providerId: string,
            tunnelId: string,
            options?: { hostname: string }
        ): Effect.Effect<void, never, PlatformManagedWebRequirements> {
            return Effect.gen({ self: this }, function* () {
                const tunnelService = yield* this.tunnels()
                yield* tunnelService
                    .deleteTunnel(providerId, tunnelId, options)
                    .pipe(Effect.ignore)
            })
        }

        state(): Effect.Effect<
            ManagedWebState,
            unknown,
            PlatformManagedWebRequirements
        > {
            return Effect.gen({ self: this }, function* () {
                const env = yield* PlatformEnvPort
                const hostnameService = yield* PlatformHostnamesPort
                const platformConfig = yield* PlatformConfigPort
                const current = yield* this.current()
                const snapshot =
                    current !== undefined
                        ? yield* current.getStateSnapshot
                        : null
                const health =
                    current !== undefined ? yield* current.getHealth : null

                return {
                    enabled: yield* platformConfig.isManagedWebAppEnabled(),
                    external: env.get('MANAGED_WEB_APP_EXTERNAL'),
                    webHostname: hostnameService.webHostname(),
                    customOrigin: yield* platformConfig.getManagedWebOrigin(),
                    tunnel: yield* platformConfig.getManagedWebTunnel(),
                    supervisorState: snapshot?.state ?? null,
                    healthy: health?.healthy ?? null,
                    detail: health?.detail ?? null,
                } satisfies ManagedWebState
            })
        }

        /** Flip the flag and converge — Traefik re-writes the console route so the single URL switches visual. */
        toggle(): Effect.Effect<
            ManagedWebState,
            unknown,
            PlatformManagedWebRequirements
        > {
            return Effect.gen({ self: this }, function* () {
                const platformConfig = yield* PlatformConfigPort
                const current = yield* platformConfig.isManagedWebAppEnabled()
                yield* platformConfig.setManagedWebAppEnabled(!current)
                yield* this.converge()
                return yield* this.state()
            })
        }

        /** Force a restart (also records enabled). */
        restart(): Effect.Effect<
            ManagedWebState,
            unknown,
            PlatformManagedWebRequirements
        > {
            return Effect.gen({ self: this }, function* () {
                const platformConfig = yield* PlatformConfigPort
                yield* platformConfig.setManagedWebAppEnabled(true)
                yield* this.converge()
                return yield* this.state()
            })
        }

        /** Set (or clear with null) the custom public origin. */
        setOrigin(
            origin: string | null
        ): Effect.Effect<
            ManagedWebState,
            unknown,
            PlatformManagedWebRequirements
        > {
            return Effect.gen({ self: this }, function* () {
                const platformConfig = yield* PlatformConfigPort
                yield* platformConfig.setManagedWebOrigin(origin)
                yield* this.converge()
                yield* Effect.logInfo(
                    `Managed web origin set to ${origin ?? '<platform default>'}`
                )
                return yield* this.state()
            })
        }

        /**
         * Provision the web app's OWN Cloudflare tunnel: create tunnel + CNAME
         * on the provider, point its ingress at the platform TRAEFIK (web:80) —
         * Traefik routes `Host(hostname) → web` — persist the identity and
         * restart the app so its public origin becomes the tunnel hostname.
         */
        enableTunnel(
            hostname: string
        ): Effect.Effect<
            ManagedWebState,
            unknown,
            PlatformManagedWebRequirements
        > {
            return Effect.gen({ self: this }, function* () {
                const platformConfig = yield* PlatformConfigPort
                const tunnelService = yield* this.tunnels()
                const provider = yield* this.resolveTunnelProvider()
                const name = `deployer-web-${hostname
                    .replace(/[^a-z0-9]+/gi, '-')
                    .replace(/^-+|-+$/g, '')
                    .slice(0, 32)}`
                const created = yield* tunnelService.createTunnel(
                    provider.providerId,
                    { name, hostname }
                )
                const tunnelHostname = created.hostname
                if (tunnelHostname === null) {
                    // No zone matched → no CNAME. Roll back the freshly created tunnel.
                    yield* this.rollback(
                        provider.providerId,
                        created.tunnel.id
                    )
                    return yield* new FleetInvalid({
                        reason: `could not resolve "${hostname}" to a zone on the Cloudflare account — the tunnel was rolled back`,
                    })
                }

                // Ingress → the platform TRAEFIK (web:80): cloudflared delivers to Traefik, which routes the
                // hostname to the web container.
                const service =
                    process.env.CLOUDFLARE_TUNNEL_SERVICE_URL?.trim() ??
                    `http://${platformTraefikContainerName(process.env.DEPLOYER_PREFIX)}:80`
                yield* tunnelService
                    .configureIngress(
                        provider.providerId,
                        created.tunnel.id,
                        tunnelHostname,
                        service
                    )
                    .pipe(
                        Effect.catch((err) =>
                            // Ingress is what makes the tunnel usable — roll the whole thing back and surface the failure.
                            this.rollback(
                                    provider.providerId,
                                    created.tunnel.id,
                                    { hostname: tunnelHostname }
                                )
                                .pipe(
                                    Effect.andThen(
                                        Effect.fail(
                                            new ServiceUnavailableError(
                                                `ingress configuration failed (${describe(err)}) — tunnel rolled back`
                                            )
                                        )
                                    )
                                )
                        )
                    )

                yield* platformConfig.setManagedWebTunnel({
                    tunnelId: created.tunnel.id,
                    hostname: tunnelHostname,
                    providerId: provider.providerId,
                })
                yield* this.converge()
                yield* Effect.logInfo(
                    `Managed web tunnel provisioned: ${tunnelHostname} → ${service}`
                )
                return yield* this.state()
            })
        }

        /** Remove the web tunnel: delete tunnel + CNAME and restart the app. */
        disableTunnel(): Effect.Effect<
            ManagedWebState,
            unknown,
            PlatformManagedWebRequirements
        > {
            return Effect.gen({ self: this }, function* () {
                const platformConfig = yield* PlatformConfigPort
                const tunnel = yield* platformConfig.getManagedWebTunnel()
                if (tunnel !== null) {
                    const tunnelService = yield* this.tunnels()
                    yield* tunnelService
                        .deleteTunnel(tunnel.providerId, tunnel.tunnelId, {
                            hostname: tunnel.hostname,
                        })
                        .pipe(
                            Effect.catch((err) =>
                                Effect.logWarning(
                                    `Web tunnel removal best-effort failed (${tunnel.tunnelId}): ${describe(err)}`
                                )
                            )
                        )
                    yield* platformConfig.clearManagedWebTunnel()
                    yield* this.converge()
                    yield* Effect.logInfo(
                        `Managed web tunnel removed: ${tunnel.hostname}`
                    )
                }
                return yield* this.state()
            })
        }
    }
}
