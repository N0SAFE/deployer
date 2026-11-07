/**
 * PlatformConfigService — typed access to platform-level settings in the
 * existing app_config KV store. The managed-web flag lives here (DB wins over
 * env after first read; MANAGED_WEB_APP_ENABLED only seeds the initial value).
 */

import { eq, or } from 'drizzle-orm'
import { Context, Effect } from 'effect'
import z from 'zod/v4'

import { appConfig } from '@deployer/nest-schema/global'

import {
    DatabasePort,
    storage,
    type StorageFailure,
} from '../../database/storage'

export const MANAGED_WEB_APP_ENABLED_KEY = 'managed_web_app.enabled'

/** Custom public origin of the managed web app (its OWN surface, distinct
 *  from the node's global API address). When unset the platform web hostname
 *  is used. */
export const MANAGED_WEB_ORIGIN_KEY = 'managed_web_app.origin'

/** Dedicated Cloudflare tunnel for the web app (own hostname + ingress to the
 *  managed web container — NOT the node's global tunnel which serves the API
 *  only). */
export const MANAGED_WEB_TUNNEL_ID_KEY = 'managed_web_app.tunnel_id'
export const MANAGED_WEB_TUNNEL_HOSTNAME_KEY = 'managed_web_app.tunnel_hostname'
export const MANAGED_WEB_TUNNEL_PROVIDER_KEY =
    'managed_web_app.tunnel_provider_id'

/** Parse a stored "true"/"false" string into a boolean (invalid → parse failure). */
const booleanValueSchema = z
    .string()
    .trim()
    .toLowerCase()
    .transform((raw, ctx) => {
        if (raw === 'true') return true
        if (raw === 'false') return false
        ctx.addIssue({ code: 'custom', message: 'expected "true" or "false"' })
        return z.NEVER
    })

/** Normalize a public origin: strip scheme, lowercase, no trailing slash. */
const normalizeHost = (origin: string): string =>
    origin
        .trim()
        .replace(/^[a-z]+:\/\//i, '')
        .replace(/\/+$/, '')
        .toLowerCase()

export type ManagedWebTunnel = {
    tunnelId: string
    hostname: string
    providerId: string
}

export type PlatformConfigServiceShape = {
    /**
     * Read the managed-web flag; seeds from env on first access. Never fails: while the `app_config` table is missing (early
     * boot, first migration) the env seed value answers.
     */
    readonly isManagedWebAppEnabled: () => Effect.Effect<boolean>
    readonly setManagedWebAppEnabled: (
        enabled: boolean
    ) => Effect.Effect<void, StorageFailure>
    /** Custom public origin of the managed web app (its OWN surface, not the node's global address); a domain or public IP. */
    readonly getManagedWebOrigin: () => Effect.Effect<string | null>
    /** Persist (or clear with null) the custom origin. The reconciler publishes it to Traefik and the web container. */
    readonly setManagedWebOrigin: (
        origin: string | null
    ) => Effect.Effect<void, StorageFailure>
    /** The web app's dedicated Cloudflare tunnel (own hostname, distinct from the node's global tunnel). */
    readonly getManagedWebTunnel: () => Effect.Effect<ManagedWebTunnel | null>
    readonly setManagedWebTunnel: (
        tunnel: ManagedWebTunnel
    ) => Effect.Effect<void, StorageFailure>
    /** Remove the tunnel identity (after the tunnel was deleted). */
    readonly clearManagedWebTunnel: () => Effect.Effect<void, StorageFailure>
}

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * The connection is a constructor argument (the Effect port, not the Nest service that owns it) and the managed-web seed is
 * a plain accessor: the module builds `new PlatformConfigService.live(database, seed)`. Nothing here yields a collaborator,
 * so a caller only has to reach the service itself.
 */
export class PlatformConfigService extends Context.Service<
    PlatformConfigService,
    PlatformConfigServiceShape
>()('shared/PlatformConfigService') {
    static readonly live = class PlatformConfigServiceImpl
        implements PlatformConfigServiceShape
    {
        constructor(
            private readonly database: Context.Service.Shape<
                typeof DatabasePort
            >,
            private readonly managedWebSeed: () => boolean
        ) {}

        /** One app_config value; null when absent or when the table cannot be read. */
        private read(key: string): Effect.Effect<string | null> {
            return storage(this.database, (db) =>
                db
                    .select()
                    .from(appConfig)
                    .where(eq(appConfig.key, key))
                    .limit(1)
            ).pipe(
                Effect.map((rows) => {
                    const raw = rows[0]?.value
                    return raw === undefined || raw === '' ? null : raw
                }),
                Effect.catch(() => Effect.succeed(null))
            )
        }

        /** Insert or update one app_config value. */
        private upsert(
            key: string,
            value: string,
            description: string | null
        ): Effect.Effect<void, StorageFailure> {
            return storage(this.database, (db) =>
                db
                    .insert(appConfig)
                    .values({ key, value, description })
                    .onConflictDoUpdate({
                        target: appConfig.key,
                        set: { value, updatedAt: new Date() },
                    })
            )
        }

        setManagedWebAppEnabled(
            enabled: boolean
        ): ReturnType<PlatformConfigServiceShape['setManagedWebAppEnabled']> {
            return this.upsert(
                MANAGED_WEB_APP_ENABLED_KEY,
                enabled ? 'true' : 'false',
                'API-centric deployment: spawn/supervise the managed web app'
            )
        }

        isManagedWebAppEnabled(): ReturnType<
            PlatformConfigServiceShape['isManagedWebAppEnabled']
        > {
            return Effect.gen({ self: this }, function* () {
                // A missing table reads as "no row": the env seed answers.
                const raw = yield* this.read(MANAGED_WEB_APP_ENABLED_KEY)
                if (raw !== null) {
                    const parsed = booleanValueSchema.safeParse(raw)
                    return parsed.success ? parsed.data : false
                }
                const seeded = this.managedWebSeed()
                yield* this.setManagedWebAppEnabled(seeded).pipe(
                    Effect.catch(() => Effect.void)
                )
                return seeded
            })
        }

        getManagedWebOrigin(): ReturnType<
            PlatformConfigServiceShape['getManagedWebOrigin']
        > {
            return Effect.gen({ self: this }, function* () {
                const raw = yield* this.read(MANAGED_WEB_ORIGIN_KEY)
                return raw === null ? null : normalizeHost(raw)
            })
        }

        setManagedWebOrigin(
            origin: string | null
        ): ReturnType<PlatformConfigServiceShape['setManagedWebOrigin']> {
            if (origin === null || origin.trim() === '') {
                return storage(this.database, (db) =>
                    db
                        .delete(appConfig)
                        .where(eq(appConfig.key, MANAGED_WEB_ORIGIN_KEY))
                )
            }
            return this.upsert(
                MANAGED_WEB_ORIGIN_KEY,
                normalizeHost(origin),
                'Custom public origin (domain/IP) of the managed web app — routed to the web container via Traefik'
            )
        }

        getManagedWebTunnel(): ReturnType<
            PlatformConfigServiceShape['getManagedWebTunnel']
        > {
            return Effect.gen({ self: this }, function* () {
                const [tunnelId, hostname, providerId] = yield* Effect.all([
                    this.read(MANAGED_WEB_TUNNEL_ID_KEY),
                    this.read(MANAGED_WEB_TUNNEL_HOSTNAME_KEY),
                    this.read(MANAGED_WEB_TUNNEL_PROVIDER_KEY),
                ])
                return tunnelId === null ||
                    hostname === null ||
                    providerId === null
                    ? null
                    : { tunnelId, hostname, providerId }
            })
        }

        setManagedWebTunnel(
            tunnel: ManagedWebTunnel
        ): ReturnType<PlatformConfigServiceShape['setManagedWebTunnel']> {
            return Effect.gen({ self: this }, function* () {
                yield* Effect.all([
                    this.upsert(MANAGED_WEB_TUNNEL_ID_KEY, tunnel.tunnelId, null),
                    this.upsert(
                        MANAGED_WEB_TUNNEL_HOSTNAME_KEY,
                        normalizeHost(tunnel.hostname),
                        null
                    ),
                    this.upsert(
                        MANAGED_WEB_TUNNEL_PROVIDER_KEY,
                        tunnel.providerId,
                        null
                    ),
                ])
            })
        }

        clearManagedWebTunnel(): ReturnType<
            PlatformConfigServiceShape['clearManagedWebTunnel']
        > {
            return storage(this.database, (db) =>
                db
                    .delete(appConfig)
                    .where(
                        or(
                            eq(appConfig.key, MANAGED_WEB_TUNNEL_ID_KEY),
                            eq(appConfig.key, MANAGED_WEB_TUNNEL_HOSTNAME_KEY),
                            eq(appConfig.key, MANAGED_WEB_TUNNEL_PROVIDER_KEY)
                        )
                    )
            )
        }
    }
}
