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
import { AppError } from '@deployer/errors'

import { Cloudflare } from 'cloudflare'
import { Context, Effect } from 'effect'
import z from 'zod/v4'

import { serviceOver, type Over } from '@deployer/effect-core'

import { attempt, attemptSync } from '@/core/effects'
import { FleetConflict, FleetInvalid, FleetNotFound } from '@/core/fleet.errors'
import {
    EdgeProviders,
    type EdgeProvidersShape,
} from '@/core/ports/edge-providers.port'
import {
    IngressLanes,
    type IngressLanesShape,
} from '@/core/ports/ingress-lanes.port'

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

type Ports = {
    readonly store: DnsProvidersStoreShape
    readonly lanes: IngressLanesShape
    readonly edges: EdgeProvidersShape
}

function parseCredentials(raw: string): CloudflareCredentials | null {
    try {
        const parsed = cloudflareCredentialsSchema.safeParse(JSON.parse(raw))
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}

function toView(row: DnsProviderRow): DnsProviderAppView {
    const features = featuresSchema.parse(row.features ?? {})
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

function makeCloudflareAppService(
    { store, lanes, edges }: Ports,
    stateCache: StateCache
) {
    // ─── Row access ──────────────────────────────────────────────────────────

    const getRow = (providerId: string) => store.findById(providerId)

    // ─── Credentials & client ────────────────────────────────────────────────

    const getCredentials = Effect.fn('CloudflareAppService.getCredentials')(
        function* (providerId: string) {
            const row = yield* getRow(providerId)
            if (!row)
                return yield* new FleetNotFound({
                    reason: `DNS provider not found: ${providerId}`,
                })
            if (!row.isActive)
                return yield* new FleetInvalid({
                    reason: `DNS provider is inactive: ${providerId}`,
                })
            const creds = parseCredentials(row.credentials)
            if (!creds)
                return yield* new FleetInvalid({
                    reason: `DNS provider has no valid API token: ${providerId}`,
                })
            return creds
        }
    )

    const buildClient = Effect.fn('CloudflareAppService.buildClient')(
        function* (providerId: string) {
            const creds = yield* getCredentials(providerId)
            return new Cloudflare({ apiToken: creds.apiToken })
        }
    )

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
        const fromZones = attempt(() =>
            client.zones.list({ per_page: 1 })
        ).pipe(
            Effect.map((page) => page.result[0]?.account?.id ?? null),
            Effect.orElseSucceed(() => null)
        )
        return Effect.flatMap(fromAccounts, (id) =>
            id ? Effect.succeed(id) : fromZones
        )
    }

    const updateConfig = (
        providerId: string,
        config: { accountId?: string | null }
    ) =>
        Effect.gen(function* () {
            const row = yield* getRow(providerId)
            yield* store.updateById(providerId, {
                config: { ...row?.config, ...config },
            })
        })

    /**
     * Resolve the Cloudflare account id for a provider, persisting it into
     * `config.accountId` so tunnel calls don't re-resolve every time.
     */
    const getOrResolveAccountId = Effect.fn(
        'CloudflareAppService.getOrResolveAccountId'
    )(function* (providerId: string) {
        const row = yield* getRow(providerId)
        const stored = row?.config?.accountId
        if (stored) return stored

        const client = yield* buildClient(providerId)
        const accountId = yield* resolveAccountId(client)
        if (!accountId) {
            return yield* new FleetInvalid({
                reason: `Could not resolve a Cloudflare account for this token. Grant "Account:Read" or "Zone:Read" permission to the API token.`,
            })
        }
        yield* updateConfig(providerId, { accountId })
        return accountId
    })

    // ─── Runtime state ───────────────────────────────────────────────────────

    const checkStateLive = (providerId: string) =>
        Effect.gen(function* () {
            const client = yield* buildClient(providerId)
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
     * Live runtime state of a provider app. TTL-cached in memory (15s) so
     * dashboards don't hammer the Cloudflare API; `force` skips the cache.
     */
    const getLiveState = Effect.fn('CloudflareAppService.getLiveState')(
        function* (providerId: string, force = false) {
            const cached = stateCache.get(providerId)
            if (!force && cached && Date.now() - cached.at < STATE_TTL_MS) {
                return cached.state
            }
            const state = yield* checkStateLive(providerId)
            stateCache.set(providerId, { at: Date.now(), state })
            // Persist as display cache only (never authoritative); a failed cache write is non-fatal.
            yield* store.updateById(providerId, { state }).pipe(Effect.ignore)
            return state
        }
    )

    // ─── App CRUD ────────────────────────────────────────────────────────────

    const listApps = Effect.fn('CloudflareAppService.listApps')(function* (
        providerType?: string
    ) {
        const rows = yield* store.list(providerType)
        // Live state for each app (parallel, TTL-cached) — runtime check, not DB.
        return yield* Effect.forEach(
            rows.map(toView),
            (view) =>
                getLiveState(view.id).pipe(
                    Effect.map((state): DnsProviderAppView => ({
                        ...view,
                        state,
                    }))
                ),
            { concurrency: 'unbounded' }
        )
    })

    const getAppView = Effect.fn('CloudflareAppService.getAppView')(function* (
        providerId: string
    ) {
        const row = yield* getRow(providerId)
        if (!row) return null
        const state = yield* getLiveState(providerId)
        return { ...toView(row), state } satisfies DnsProviderAppView
    })

    const createApp = Effect.fn('CloudflareAppService.createApp')(
        function* (input: {
            name: string
            providerType: string
            apiToken: string
            accountEmail?: string
            features?: Partial<DnsProviderFeatures>
        }) {
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

            const state = yield* getLiveState(row.id, true)
            return { ...toView(row), state } satisfies DnsProviderAppView
        }
    )

    const updateApp = Effect.fn('CloudflareAppService.updateApp')(function* (
        providerId: string,
        input: {
            name?: string
            isActive?: boolean
            features?: Partial<DnsProviderFeatures>
        }
    ) {
        const existing = yield* getRow(providerId)
        if (!existing)
            return yield* new FleetNotFound({
                reason: `DNS provider not found: ${providerId}`,
            })

        const features = input.features
            ? featuresSchema.parse({ ...existing.features, ...input.features })
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
        stateCache.delete(providerId)
        const state = yield* getLiveState(providerId, true)
        return { ...toView(row), state } satisfies DnsProviderAppView
    })

    const deleteApp = Effect.fn('CloudflareAppService.deleteApp')(function* (
        providerId: string
    ) {
        // Guard: an account the public edge runs on (a tunnel's account) cannot be
        // deleted while in use — the edge would keep a credential whose account is
        // gone and fail with no obvious cause. Generic: the registry knows which
        // lane options are DNS accounts, whatever the edge provider.
        const current = yield* lanes.getLanes()
        const inUse = yield* attemptSync(() => edges.accountsInUse(current))
        if (inUse.includes(providerId)) {
            return yield* new FleetConflict({
                reason: "Cannot delete: the stack's public edge runs on this account. Switch or tear down the public edge in Network → Ingress first.",
            })
        }
        yield* store.deleteById(providerId)
        stateCache.delete(providerId)
        yield* Effect.logInfo(`DNS provider ${providerId} deleted`)
        return true
    })

    /**
     * Apps that can back a node tunnel: active, tunnelManagement enabled and
     * runtime state healthy.
     */
    const listTunnelCapableApps = Effect.fn(
        'CloudflareAppService.listTunnelCapableApps'
    )(function* () {
        const views = yield* listApps('cloudflare')
        return views.filter(
            (v) =>
                v.isActive &&
                v.features.tunnelManagement &&
                v.state?.status === 'ok'
        )
    })

    return {
        getAppView,
        listApps,
        createApp,
        updateApp,
        deleteApp,
        getCredentials,
        buildClient,
        getOrResolveAccountId,
        getLiveState,
        listTunnelCapableApps,
    }
}

export type CloudflareAppServiceShape = Over<
    ReturnType<typeof makeCloudflareAppService>,
    DnsProvidersStore | IngressLanes | EdgeProviders
>

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class CloudflareAppService extends Context.Service<
    CloudflareAppService,
    CloudflareAppServiceShape
>()('fleet/CloudflareAppService') {
    /**
     * The collaborators are yielded when a method runs, so this is a constant the module provides with
     * `useValue`. The 15 s live-state cache is one value created here, shared by every call.
     */
    static readonly live: CloudflareAppServiceShape = (() => {
        const stateCache: StateCache = new Map()
        return serviceOver(
            Effect.all({
                store: DnsProvidersStore,
                lanes: IngressLanes,
                edges: EdgeProviders,
            }),
            (ports) => makeCloudflareAppService(ports, stateCache)
        )
    })()
}
