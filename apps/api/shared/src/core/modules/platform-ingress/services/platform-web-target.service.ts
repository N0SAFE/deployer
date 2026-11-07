/**
 * PlatformWebTargetService — resolves WHICH container serves the web on the
 * platform network, as a single source of truth shared by:
 *
 *   - the Traefik supervisor (writes the `web.deployer.localhost` route
 *     backend in dynamic-web.yml),
 *   - the failover direct-port proxy (default web forward target).
 *
 * Resolution order:
 *   1. explicit `DEPLOYER_WEB_TARGET` (compose/dev side-by-side stacks pass
 *      the compose web container name, e.g. `web-dev`),
 *   2. the API-supervised managed web container (`deployer-managed-web`),
 *      when the managed_web_app.enabled flag is on,
 *   3. null → no web route is written / no web forward (Traefik 404s the
 *      hostname cleanly instead of proxying to a missing container).
 *
 * The returned name is resolved over the PLATFORM network (docker embedded
 * DNS) — the container must be attached to it (compose: join the platform
 * network; managed web: the supervisor spawns it there).
 */

import { Context, Effect } from 'effect'

import { PlatformConfigService } from './platform-config.service'
import { MANAGED_WEB_CONTAINER_BASE_NAME } from './platform-names'

/** The environment values the resolution reads, resolved once by the module. */
export type PlatformWebTargetEnv = {
    readonly webTarget: string | undefined
    readonly managedWebExternal: boolean
    /** `DEPLOYER_PREFIX` — '' on an unprefixed install. */
    readonly prefix: string
}

export type PlatformWebTargetServiceShape = {
    /** The web container name on the platform network, or null when no web should be served (no route / no forward). */
    readonly resolveWebTarget: () => Effect.Effect<
        string | null,
        never,
        PlatformConfigService
    >
}

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * The managed-web flag is yielded per call (it changes at runtime); the three environment values are plain values the
 * module resolves from the existing accessors, so `live` reads no environment itself.
 */
export class PlatformWebTargetService extends Context.Service<
    PlatformWebTargetService,
    PlatformWebTargetServiceShape
>()('shared/PlatformWebTargetService') {
    static readonly live = class PlatformWebTargetServiceImpl
        implements PlatformWebTargetServiceShape
    {
        constructor(private readonly env: PlatformWebTargetEnv) {}

        resolveWebTarget(): ReturnType<
            PlatformWebTargetServiceShape['resolveWebTarget']
        > {
            return Effect.gen({ self: this }, function* () {
                const explicit = this.env.webTarget?.trim()
                if (explicit !== undefined && explicit !== '') return explicit

                // The API-supervised managed web owns the surface unless an external web (compose side-by-side / BYO) is declared.
                if (this.env.managedWebExternal) return null
                const platformConfig = yield* PlatformConfigService
                if (!(yield* platformConfig.isManagedWebAppEnabled()))
                    return null

                return this.env.prefix === ''
                    ? MANAGED_WEB_CONTAINER_BASE_NAME
                    : `${MANAGED_WEB_CONTAINER_BASE_NAME}-${this.env.prefix}`
            })
        }
    }
}
