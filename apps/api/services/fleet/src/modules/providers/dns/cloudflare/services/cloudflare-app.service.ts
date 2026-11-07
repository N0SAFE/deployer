/**
 * Cloudflare App Service — the "app" model for a Cloudflare DNS provider.
 *
 * A provider "app" is one `dns_providers` row (token-backed). This service
 * owns:
 *   - CRUD of provider apps (create verifies the token at runtime).
 *   - LIVE runtime state (token validity, account id) with a short in-memory
 *     TTL — the DB `state` column is only a display cache, never the source
 *     of truth.
 *   - Feature flags (dnsManagement / tunnelManagement) that other modules
 *     gate on.
 *
 * Tunnel + zone/record operations live in CloudflareTunnelService and
 * CloudflareDnsProviderService respectively.
 *
 * A use case fails with `FleetNotFound`, `FleetInvalid` or `FleetConflict` of its own, or with
 * whatever the database or the Cloudflare SDK raised (kept as thrown, see `attempt`).
 */
import { Cloudflare } from 'cloudflare'
import { Context, Effect } from 'effect'
import z from 'zod/v4'

import type { RequirementsOf } from '@deployer/effect-core'
import { AppError } from '@deployer/errors'

import { attempt, attemptSync } from '@/core/effects'
import { FleetConflict, FleetInvalid, FleetNotFound } from '@/core/fleet.errors'
import { EdgeProviders } from '@/core/ports/edge-providers.port'
import { IngressLanes, type IngressLanesShape } from '@/core/ports/ingress-lanes.port'

import {
    DnsProvidersStore,
    type DnsProvidersStoreShape,
} from '../../shared/repositories/dns-providers.repository'

import { toCloudflareErrorMessage } from './cloudflare.helpers'

type DnsProviderRow =
    typeof import('@deployer/nest-schema/global').dnsProviders.$inferSelect
export type DnsProviderRuntimeState =
    import('@deployer/nest-schema/global').DnsProviderRuntimeState
export type DnsProviderFeatures =
    import('@deployer/nest-schema/global').DnsProviderFeatures

const cloudflareCredentialsSchema = z.object({
    apiToken: z.string().min(1),
    accountEmail: z.string().optional(),
})
export type CloudflareCredentials = z.infer<typeof cloudflareCredentialsSchema>

const featuresSchema = z.object({
    dnsManagement: z.boolean().default(true),
    tunnelManagement: z.boolean().default(false),
})

export type DnsProviderAppView = {
    id: string
    name: string
    providerType: string
    isActive: boolean
    features: DnsProviderFeatures
    state: DnsProviderRuntimeState | null
    createdAt: string
    updatedAt: string
}

const STATE_TTL_MS = 15_000

/** In-memory TTL cache of the last live state check (never authoritative). */
type StateCache = Map<string, { at: number; state: DnsProviderRuntimeState }>

/**
 * What an app-service method reads from the Effect context: the row store (with the database pool it
 * borrows) and the two platform services the delete guard consults about the public edge.
 */
type AppRequirements =
    | DnsProvidersStore
    | RequirementsOf<DnsProvidersStoreShape>
    | IngressLanes
    // The lanes read the replicated cluster settings, so that tag is part of what a caller must provide.
    | RequirementsOf<IngressLanesShape>
    | EdgeProviders

function parseCredentials(raw: string): CloudflareCredentials | null {
    try {
        const parsed = cloudflareCredentialsSchema.safeParse(JSON.parse(raw))
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}

function toView(row: DnsProviderRow): DnsProviderAppView {
    const features = featuresSchema.parse(row.features)
    return {
        id: row.id,
        name: row.name,
        providerType: row.providerType,
        isActive: row.isActive,
        features,
        state: row.state,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }
}

/**
 * The last live-state check per provider, kept across calls: one value for the process, which is
 * what providing this service as a module constant gave it before.
 */
const STATE_CACHE: StateCache = new Map()

// ─── Credentials & client ────────────────────────────────────────────────────

/** The stored credentials of a provider that is active and holds a token. */
const credentialOf = Effect.fn('CloudflareAppService.getCredentials')(function* (
    store: DnsProvidersStoreShape,
    providerId: string
) {
    const row = yield* store.findById(providerId)
    if (!row)
        return yield* new FleetNotFound({
            reason: `DNS provider not found: ${providerId}`,
        })
    if (!row.isActive)
        return yield* new FleetInvalid({
            reason: `DNS provider is inactive: ${providerId}`,
        })
    const credentials = parseCredentials(row.credentials)
    if (!credentials)
        return yield* new FleetInvalid({
            reason: `DNS provider has no valid API token: ${providerId}`,
        })
    return credentials
})

/** A Cloudflare client built from those credentials. */
const clientOf = Effect.fn('CloudflareAppService.buildClient')(function* (
    store: DnsProvidersStoreShape,
    providerId: string
) {
    const credentials = yield* credentialOf(store, providerId)
    return new Cloudflare({ apiToken: credentials.apiToken })
})

/** The account the token belongs to: the first account it lists, else its first zone's account. */
const resolveAccountId = (
    client: Cloudflare
): Effect.Effect<string | null> => {
    const fromAccounts = attempt(() =>
        client.accounts.list({ per_page: 1 })
    ).pipe(
        Effect.map((page) => page.result[0]?.id ?? null),
        Effect.orElseSucceed(() => null)
    )
    const fromZones = attempt(() => client.zones.list({ per_page: 1 })).pipe(
        Effect.map((page) => page.result[0]?.account.id ?? null),
        Effect.orElseSucceed(() => null)
    )
    return Effect.flatMap(fromAccounts, (id) =>
        id ? Effect.succeed(id) : fromZones
    )
}

/** Remember the account the token belongs to, so tunnel calls don't re-resolve it every time. */
const persistAccountId = Effect.fn('CloudflareAppService.updateConfig')(
    function* (
        store: DnsProvidersStoreShape,
        providerId: string,
        config: { accountId?: string | null }
    ) {
        const row = yield* store.findById(providerId)
        yield* store.updateById(providerId, {
            config: { ...row?.config, ...config },
        })
    }
)

/** The Cloudflare account id for a provider, resolved once and then persisted on the row. */
const accountIdOf = Effect.fn('CloudflareAppService.getOrResolveAccountId')(
    function* (store: DnsProvidersStoreShape, providerId: string) {
        const row = yield* store.findById(providerId)
        const stored = row?.config.accountId
        if (stored) return stored

        const client = yield* clientOf(store, providerId)
        const accountId = yield* resolveAccountId(client)
        if (!accountId) {
            return yield* new FleetInvalid({
                reason: `Could not resolve a Cloudflare account for this token. Grant "Account:Read" or "Zone:Read" permission to the API token.`,
            })
        }
        yield* persistAccountId(store, providerId, { accountId })
        return accountId
    }
)

    // ─── Runtime state ───────────────────────────────────────────────────────

/**
 * Live runtime state of a provider app, checked against Cloudflare.
 *
 * A failure is an error STATE (`status: 'error'`), never a failure: the dashboards must show a broken
 * provider, not a broken page.
 */
const checkStateLive = (store: DnsProvidersStoreShape, providerId: string) =>
    Effect.gen(function* () {
        const client = yield* clientOf(store, providerId)
        const verify = yield* attempt(() => client.user.tokens.verify())
        const accountId = yield* resolveAccountId(client)
        const checkedAt = new Date().toISOString()
        if (verify.status !== 'active') {
            return {
                status: 'error',
                checkedAt,
                accountId,
                tokenValid: false,
                error: `Token status is "${verify.status}"`,
            } satisfies DnsProviderRuntimeState
        }
        return {
            status: 'ok',
            checkedAt,
            accountId,
            tokenValid: true,
            error: null,
        } satisfies DnsProviderRuntimeState
    }).pipe(
        Effect.catch((err) =>
            Effect.succeed({
                status: 'error',
                checkedAt: new Date().toISOString(),
                accountId: null,
                tokenValid: false,
                error: toCloudflareErrorMessage(err),
            } satisfies DnsProviderRuntimeState)
        )
    )

/**
 * Live runtime state of a provider app. TTL-cached in memory (15s) so dashboards don't hammer the
 * Cloudflare API; `force` skips the cache.
 */
const liveStateOf = (
    store: DnsProvidersStoreShape,
    providerId: string,
    force = false
) =>
    Effect.gen(function* () {
        const cached = STATE_CACHE.get(providerId)
        if (!force && cached && Date.now() - cached.at < STATE_TTL_MS) {
            return cached.state
        }
        const state = yield* checkStateLive(store, providerId)
        STATE_CACHE.set(providerId, { at: Date.now(), state })
        // Persist as display cache only (never authoritative); a failed cache write is non-fatal.
        yield* store.updateById(providerId, { state }).pipe(Effect.ignore)
        return state
    })

/**
 * Every app, with its live state — fetched in parallel, each state TTL-cached. Shared by `listApps`
 * and `listTunnelCapableApps` so the two cannot drift.
 */
const viewsWithState = (store: DnsProvidersStoreShape, providerType?: string) =>
    Effect.gen(function* () {
        const rows = yield* store.list(providerType)
        return yield* Effect.forEach(
            rows.map(toView),
            (view) =>
                liveStateOf(store, view.id).pipe(
                    Effect.map((state): DnsProviderAppView => ({
                        ...view,
                        state,
                    }))
                ),
            { concurrency: 'unbounded' }
        )
    })

/**
 * The app model of a DNS provider: CRUD of provider rows, their live runtime state, and the feature
 * flags the tunnel and DNS surfaces gate on.
 *
 * Every method yields its collaborators when it runs — the row store, and the two platform services the
 * delete guard consults — so the service is a constant and the 15 s state cache is one value for the
 * process.
 */
export type CloudflareAppServiceShape = {
    readonly getAppView: (
        providerId: string
    ) => Effect.Effect<DnsProviderAppView | null, unknown, AppRequirements>
    readonly listApps: (
        providerType?: string
    ) => Effect.Effect<DnsProviderAppView[], unknown, AppRequirements>
    readonly createApp: (input: {
        name: string
        providerType: string
        apiToken: string
        accountEmail?: string
        features?: Partial<DnsProviderFeatures>
    }) => Effect.Effect<DnsProviderAppView, unknown, AppRequirements>
    readonly updateApp: (
        providerId: string,
        input: {
            name?: string
            isActive?: boolean
            features?: Partial<DnsProviderFeatures>
        }
    ) => Effect.Effect<DnsProviderAppView, unknown, AppRequirements>
    readonly deleteApp: (
        providerId: string
    ) => Effect.Effect<boolean, unknown, AppRequirements>
    readonly getCredentials: (
        providerId: string
    ) => Effect.Effect<CloudflareCredentials, unknown, AppRequirements>
    readonly buildClient: (
        providerId: string
    ) => Effect.Effect<Cloudflare, unknown, AppRequirements>
    readonly getOrResolveAccountId: (
        providerId: string
    ) => Effect.Effect<string, unknown, AppRequirements>
    readonly getLiveState: (
        providerId: string,
        force?: boolean
    ) => Effect.Effect<DnsProviderRuntimeState, unknown, AppRequirements>
    readonly listTunnelCapableApps: () => Effect.Effect<
        DnsProviderAppView[],
        unknown,
        AppRequirements
    >
}

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class CloudflareAppService extends Context.Service<
    CloudflareAppService,
    CloudflareAppServiceShape
>()('fleet/CloudflareAppService') {
    static readonly live = class CloudflareAppServiceImpl
        implements CloudflareAppServiceShape
    {
        getAppView(
            providerId: string
        ): ReturnType<CloudflareAppServiceShape['getAppView']> {
            return Effect.gen(function* () {
                const store = yield* DnsProvidersStore
                const row = yield* store.findById(providerId)
                if (!row) return null
                const state = yield* liveStateOf(store, providerId)
                return { ...toView(row), state } satisfies DnsProviderAppView
            })
        }

        listApps(
            providerType?: string
        ): ReturnType<CloudflareAppServiceShape['listApps']> {
            return Effect.gen(function* () {
                return yield* viewsWithState(
                    yield* DnsProvidersStore,
                    providerType
                )
            })
        }

        createApp(
            input: {
                name: string
                providerType: string
                apiToken: string
                accountEmail?: string
                features?: Partial<DnsProviderFeatures>
            }
        ): ReturnType<CloudflareAppServiceShape['createApp']> {
            return Effect.gen(function* () {
                const store = yield* DnsProvidersStore
                // Only the implemented provider may be created. The UI may still offer
                // route53/google-dns/etc. rows in legacy forms — those must NEVER be
                // persisted with Cloudflare credentials (credential-smuggling CF-2).
                if (input.providerType !== 'cloudflare') {
                    return yield* new FleetInvalid({
                        reason: `DNS provider '${input.providerType}' is not supported yet — only 'cloudflare' is available`,
                    })
                }

                // Verify the token at runtime BEFORE persisting anything.
                const client = new Cloudflare({ apiToken: input.apiToken })
                const verify = yield* attempt(() =>
                    client.user.tokens.verify()
                ).pipe(
                    Effect.mapError(
                        (err) =>
                            new FleetInvalid({
                                reason: `Invalid Cloudflare API token: ${err instanceof Error ? err.message : 'verification failed'}`,
                            })
                    )
                )
                if (verify.status !== 'active') {
                    return yield* new FleetInvalid({
                        reason: `Token status is "${verify.status}" — expected "active"`,
                    })
                }

                const credentials = JSON.stringify({
                    apiToken: input.apiToken,
                    ...(input.accountEmail
                        ? { accountEmail: input.accountEmail }
                        : {}),
                })
                const features = featuresSchema.parse({
                    dnsManagement: true,
                    tunnelManagement: false,
                    ...input.features,
                })

                const row = yield* store.create({
                    providerType: input.providerType,
                    name: input.name,
                    isActive: true,
                    credentials,
                    config: { accountId: null },
                    features,
                    state: null,
                })
                if (!row)
                    return yield* Effect.fail(
                        new AppError(
                            'Failed to create DNS provider',
                            'INTERNAL_ERROR'
                        )
                    )
                yield* Effect.logInfo(
                    `DNS provider "${input.name}" created (${input.providerType})`
                )

                const state = yield* liveStateOf(store, row.id, true)
                return { ...toView(row), state } satisfies DnsProviderAppView
            })
        }

        updateApp(
            providerId: string,
            input: {
                name?: string
                isActive?: boolean
                features?: Partial<DnsProviderFeatures>
            }
        ): ReturnType<CloudflareAppServiceShape['updateApp']> {
            return Effect.gen(function* () {
                const store = yield* DnsProvidersStore
                const existing = yield* store.findById(providerId)
                if (!existing)
                    return yield* new FleetNotFound({
                        reason: `DNS provider not found: ${providerId}`,
                    })

                const features = input.features
                    ? featuresSchema.parse({
                          ...existing.features,
                          ...input.features,
                      })
                    : undefined

                const row = yield* store.updateById(providerId, {
                    ...(input.name !== undefined ? { name: input.name } : {}),
                    ...(input.isActive !== undefined
                        ? { isActive: input.isActive }
                        : {}),
                    ...(features ? { features } : {}),
                })
                if (!row)
                    return yield* new FleetNotFound({
                        reason: `DNS provider not found: ${providerId}`,
                    })
                STATE_CACHE.delete(providerId)
                const state = yield* liveStateOf(store, providerId, true)
                return { ...toView(row), state } satisfies DnsProviderAppView
            })
        }

        deleteApp(
            providerId: string
        ): ReturnType<CloudflareAppServiceShape['deleteApp']> {
            return Effect.gen(function* () {
                const store = yield* DnsProvidersStore
                const lanes = yield* IngressLanes
                const edges = yield* EdgeProviders
                // Guard: an account the public edge runs on (a tunnel's account) cannot be
                // deleted while in use — the edge would keep a credential whose account is
                // gone and fail with no obvious cause. Generic: the registry knows which
                // lane options are DNS accounts, whatever the edge provider.
                const current = yield* lanes.getLanes()
                const inUse = yield* attemptSync(() =>
                    edges.accountsInUse(current)
                )
                if (inUse.includes(providerId)) {
                    return yield* new FleetConflict({
                        reason: "Cannot delete: the stack's public edge runs on this account. Switch or tear down the public edge in Network → Ingress first.",
                    })
                }
                yield* store.deleteById(providerId)
                STATE_CACHE.delete(providerId)
                yield* Effect.logInfo(`DNS provider ${providerId} deleted`)
                return true
            })
        }

        getCredentials(
            providerId: string
        ): ReturnType<CloudflareAppServiceShape['getCredentials']> {
            return Effect.gen(function* () {
                return yield* credentialOf(yield* DnsProvidersStore, providerId)
            })
        }

        buildClient(
            providerId: string
        ): ReturnType<CloudflareAppServiceShape['buildClient']> {
            return Effect.gen(function* () {
                return yield* clientOf(yield* DnsProvidersStore, providerId)
            })
        }

        getOrResolveAccountId(
            providerId: string
        ): ReturnType<CloudflareAppServiceShape['getOrResolveAccountId']> {
            return Effect.gen(function* () {
                return yield* accountIdOf(yield* DnsProvidersStore, providerId)
            })
        }

        getLiveState(
            providerId: string,
            force = false
        ): ReturnType<CloudflareAppServiceShape['getLiveState']> {
            return Effect.gen(function* () {
                return yield* liveStateOf(
                    yield* DnsProvidersStore,
                    providerId,
                    force
                )
            })
        }

        /**
         * Apps that can back a node tunnel: active, tunnelManagement enabled and
         * runtime state healthy.
         */
        listTunnelCapableApps(): ReturnType<
            CloudflareAppServiceShape['listTunnelCapableApps']
        > {
            return Effect.gen(function* () {
                const views = yield* viewsWithState(
                    yield* DnsProvidersStore,
                    'cloudflare'
                )
                return views.filter(
                    (v) =>
                        v.isActive &&
                        v.features.tunnelManagement &&
                        v.state?.status === 'ok'
                )
            })
        }
    }
}
