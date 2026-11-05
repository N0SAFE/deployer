/**
 * Cloudflare Tunnel Service — tunnel management on a Cloudflare provider app.
 *
 * All operations require the provider app to be active AND have the
 * `tunnelManagement` feature enabled (checked at runtime). The Cloudflare
 * account id is resolved at runtime (never from env vars).
 *
 * The read operations answer `{ error }` instead of failing; the write operations fail with a
 * `BadGatewayException` carrying Cloudflare's reason (kept as thrown, see `attempt`).
 */
import { serviceOver, type Over } from '@deployer/effect-core'

import { BadGatewayException } from '@nestjs/common'
import { Context, Effect } from 'effect'

import { attempt } from '@/core/effects'
import { FleetInvalid, FleetNotFound } from '@/core/fleet.errors'

import {
    CloudflareAppService,
    type CloudflareAppServiceShape,
} from './cloudflare-app.service'
import {
    CloudflareDnsProviderService,
    type CloudflareDnsProviderServiceShape,
} from './cloudflare-dns-provider.service'
import {
    toCloudflareErrorMessage,
    toTunnelConnectionShape,
    toTunnelShape,
    type TunnelConnectionShape,
    type TunnelShape,
} from './cloudflare.helpers'

import type { Cloudflare } from 'cloudflare'
import type { ConfigurationUpdateParams } from 'cloudflare/resources/zero-trust/tunnels/cloudflared/configurations'
import type { Client } from 'cloudflare/resources/zero-trust/tunnels/cloudflared/connections'

/**
 * Cloudflare's ingress rules, as the API defines them — deliberately NOT the
 * SDK's `Config.Ingress`.
 *
 * The SDK declares `hostname` as REQUIRED on every rule. Cloudflare requires the
 * opposite for the FINAL rule: it must carry no hostname and no path, otherwise
 * the entire configuration is refused with
 *
 *   400 code 1056 — "The last ingress rule must match all URLs
 *                     (i.e. it should not have a hostname or path filter)"
 *
 * so a payload shaped to satisfy the SDK's type can never be accepted. `hostname`
 * is optional here because that is what the endpoint actually takes.
 */
type CloudflareIngressRule = {
    hostname?: string
    path?: string
    service: string
}

/**
 * Terminator for every ingress list: a request that matched no rule above gets a
 * 404 from Cloudflare, rather than falling through to an unintended origin.
 */
const INGRESS_CATCH_ALL: CloudflareIngressRule = { service: 'http_status:404' }

/**
 * A tunnel token is a credential, so the management surface may report that one
 * EXISTS, never its value (NET-002). Only the last four characters survive —
 * enough for an operator to tell two tokens apart, useless as a secret.
 */
const maskTunnelToken = (token: unknown): string | null => {
    const value = typeof token === 'string' ? token.trim() : ''
    return value === '' ? null : `****${value.slice(-4)}`
}

type Ports = {
    readonly apps: CloudflareAppServiceShape
    readonly dns: CloudflareDnsProviderServiceShape
}

function makeCloudflareTunnelService({ apps, dns }: Ports) {
    /** App view with the tunnelManagement feature gate applied. */
    const requireTunnelApp = Effect.fn(
        'CloudflareTunnelService.requireTunnelApp'
    )(function* (providerId: string) {
        const app = yield* apps.getAppView(providerId)
        if (!app)
            return yield* new FleetNotFound({
                reason: `DNS provider not found: ${providerId}`,
            })
        if (!app.isActive)
            return yield* new FleetInvalid({
                reason: `DNS provider is inactive: ${providerId}`,
            })
        if (!app.features.tunnelManagement) {
            return yield* new FleetInvalid({
                reason: `Tunnel management is not enabled on "${app.name}". Enable it in the Cloudflare app configuration first.`,
            })
        }
        return app
    })

    const clientFor = Effect.fn('CloudflareTunnelService.clientFor')(function* (
        providerId: string
    ) {
        const app = yield* requireTunnelApp(providerId)
        const client = yield* apps.buildClient(providerId)
        const accountId = yield* apps.getOrResolveAccountId(providerId)
        return { app, client, accountId }
    })

    const fetchConnections = (
        client: Cloudflare,
        accountId: string,
        tunnelId: string
    ): Effect.Effect<TunnelConnectionShape[]> =>
        attempt(() =>
            client.zeroTrust.tunnels.cloudflared.connections.get(tunnelId, {
                account_id: accountId,
            })
        ).pipe(
            Effect.map((page) =>
                page.result.map((c: Client) => toTunnelConnectionShape(c))
            ),
            Effect.catch((error) =>
                Effect.logWarning(
                    `cloudflareFetchTunnelConnections failed for tunnel ${tunnelId}: ${error instanceof Error ? error.message : String(error)}`
                ).pipe(Effect.as([]))
            )
        )

    /**
     * The live tunnel with this name, or `null`.
     *
     * Cloudflare enforces tunnel names per account (error 1013 — "You already
     * have a tunnel with this name"). That check runs BEFORE any local bookkeeping
     * we do, so a run that created the tunnel and then failed later — a refused
     * ingress, a crash — leaves an orphan the next attempt collides with, while
     * our stored `tunnelId` is still empty and the guard upstream looks satisfied.
     * Reusing by name makes provisioning idempotent instead of wedging the node.
     */
    const findTunnelByName = (
        client: Cloudflare,
        accountId: string,
        name: string
    ) =>
        attempt(() =>
            client.zeroTrust.tunnels.cloudflared.list({
                account_id: accountId,
                is_deleted: false,
                name,
                per_page: 100,
            })
        ).pipe(
            Effect.map((page) => {
                const match = page.result.find(
                    (candidate) => candidate.name === name && candidate.id
                )
                return match?.id ? { id: match.id } : null
            })
        )

    // ─── Tunnels ─────────────────────────────────────────────────────────────

    const listTunnels = Effect.fn('CloudflareTunnelService.listTunnels')(
        function* (providerId: string) {
            return yield* Effect.gen(function* () {
                const { client, accountId } = yield* clientFor(providerId)
                const page = yield* attempt(() =>
                    client.zeroTrust.tunnels.cloudflared.list({
                        account_id: accountId,
                        is_deleted: false,
                        per_page: 100,
                    })
                )
                const tunnels = page.result.map((t) =>
                    toTunnelShape(
                        t,
                        (t.connections ?? []).map((c) =>
                            toTunnelConnectionShape(c)
                        )
                    )
                )
                return { tunnels, error: null as string | null }
            }).pipe(
                Effect.catch((err) =>
                    Effect.logWarning(
                        `cloudflareListTunnels failed for provider ${providerId}: ${err instanceof Error ? err.message : String(err)}`
                    ).pipe(
                        Effect.as({
                            tunnels: [] as TunnelShape[],
                            error: toCloudflareErrorMessage(err),
                        })
                    )
                )
            )
        }
    )

    const getTunnel = Effect.fn('CloudflareTunnelService.getTunnel')(function* (
        providerId: string,
        tunnelId: string
    ) {
        return yield* Effect.gen(function* () {
            const { client, accountId } = yield* clientFor(providerId)
            const tunnel = yield* attempt(() =>
                client.zeroTrust.tunnels.cloudflared.get(tunnelId, {
                    account_id: accountId,
                })
            )
            const connections = yield* fetchConnections(
                client,
                accountId,
                tunnelId
            )
            return {
                tunnel: toTunnelShape(tunnel, connections),
                error: null as string | null,
            }
        }).pipe(
            Effect.catch((err) =>
                Effect.logWarning(
                    `cloudflareGetTunnel failed for provider ${providerId}: ${err instanceof Error ? err.message : String(err)}`
                ).pipe(
                    Effect.as({
                        tunnel: null as TunnelShape | null,
                        error: toCloudflareErrorMessage(err),
                    })
                )
            )
        )
    })

    /**
     * Auto-setup: create the tunnel, fetch its `cloudflared` run token, and
     * (when a hostname is given) create the CNAME routing record.
     */
    const createTunnel = Effect.fn('CloudflareTunnelService.createTunnel')(
        function* (
            providerId: string,
            input: { name: string; hostname?: string }
        ) {
            return yield* Effect.gen(function* () {
                const { client, accountId, app } = yield* clientFor(providerId)

                // Reuse a tunnel this account already owns under the same name — see
                // `findTunnelByName` for why re-creating one wedges the node rather
                // than being harmless.
                const existing = yield* findTunnelByName(
                    client,
                    accountId,
                    input.name
                )
                const created =
                    existing ??
                    (yield* attempt(() =>
                        client.zeroTrust.tunnels.cloudflared.create({
                            account_id: accountId,
                            name: input.name,
                        })
                    ))
                if (!created.id)
                    return yield* Effect.fail(
                        new BadGatewayException(
                            'Cloudflare did not return a tunnel id'
                        )
                    )
                const tunnelId = created.id
                if (existing) {
                    yield* Effect.logInfo(
                        `Reusing existing Cloudflare tunnel "${input.name}" (${tunnelId}) on app "${app.name}"`
                    )
                }

                const token = yield* attempt(() =>
                    client.zeroTrust.tunnels.cloudflared.token.get(tunnelId, {
                        account_id: accountId,
                    })
                )

                let dnsRecord: string | null = null
                let hostname: string | null = null
                if (input.hostname) {
                    const zone = yield* dns.findZoneForHostname(
                        { providerId, providerType: 'cloudflare' },
                        input.hostname
                    )
                    if (zone) {
                        const record = yield* dns.createRecord(
                            { providerId, providerType: 'cloudflare' },
                            {
                                zoneId: zone.zoneId,
                                type: 'CNAME',
                                name: input.hostname,
                                content: `${tunnelId}.cfargotunnel.com`,
                                ttl: 1,
                                proxied: true,
                            }
                        )
                        dnsRecord = record.id
                        hostname = input.hostname
                    }
                }
                yield* Effect.logInfo(
                    `Cloudflare tunnel "${input.name}" created on app "${app.name}" (${tunnelId})`
                )
                return {
                    tunnel: toTunnelShape(created),
                    token,
                    dnsRecord,
                    hostname,
                    error: null,
                }
            }).pipe(
                Effect.tapError((err) =>
                    Effect.logWarning(
                        `cloudflareCreateTunnel failed for provider ${providerId}: ${err instanceof Error ? err.message : String(err)}`
                    )
                ),
                Effect.mapError(
                    (err) =>
                        new BadGatewayException(toCloudflareErrorMessage(err), {
                            cause: err,
                        })
                )
            )
        }
    )

    /**
     * Read the tunnel's current ingress, replace the rule for `hostname`, and put
     * the catch-all back at the end.
     *
     * @returns how many OTHER hostname rules were preserved, for the caller to log.
     */
    const applyIngressRules = (
        client: Cloudflare,
        accountId: string,
        tunnelId: string,
        hostname: string,
        service: string
    ) =>
        Effect.gen(function* () {
            // Read the CURRENT rules so this call replaces the rule for `hostname`
            // only. Writing a freshly-built array dropped every other hostname routed
            // through the same tunnel, and the damage was silent: the next request for
            // a dropped hostname answered 1033 "unable to resolve" while the tunnel
            // and its CNAME both still looked healthy.
            const current = yield* attempt(() =>
                client.zeroTrust.tunnels.cloudflared.configurations.get(
                    tunnelId,
                    { account_id: accountId }
                )
            )
            const existingRules: CloudflareIngressRule[] =
                current.config?.ingress ?? []

            // Keep the other hostnames' rules; drop this hostname's previous rule(s)
            // and any earlier terminator, both of which are re-added below. A rule
            // without a hostname IS a terminator, which is why it is filtered here.
            const preserved = existingRules.filter(
                (rule) =>
                    rule.hostname !== undefined && rule.hostname !== hostname
            )

            // Cloudflare requires the FINAL rule to match every URL — no hostname, no
            // path. Without `INGRESS_CATCH_ALL` the whole configuration is rejected:
            // 400 code 1056 "The last ingress rule must match all URLs".
            const ingress: CloudflareIngressRule[] = [
                ...preserved,
                { hostname, service },
                INGRESS_CATCH_ALL,
            ]

            yield* attempt(() =>
                client.zeroTrust.tunnels.cloudflared.configurations.update(
                    tunnelId,
                    {
                        account_id: accountId,
                        // The one assertion in this file. The SDK's `Ingress` type demands a
                        // `hostname` that Cloudflare forbids on the final rule, so the type is
                        // wrong rather than the payload: `ConfigurationUpdateParams.Config.Ingress`
                        // is assignable to `CloudflareIngressRule` (required → optional widens),
                        // which is what makes this assertion legal. Cloudflare validates the
                        // result itself and answers 400/1056 if any rule is actually malformed.
                        config: {
                            ingress:
                                ingress as ConfigurationUpdateParams.Config.Ingress[],
                        },
                    }
                )
            )
            return preserved.length
        })

    /**
     * Configure the tunnel's ingress (public hostname → local service) so
     * `cloudflared` knows where to route requests for `hostname` once a
     * connector is running. WITHOUT this, Cloudflare answers error 1033
     * ("Cloudflare is currently unable to resolve it") even when the DNS
     * CNAME and the tunnel exist — the tunnel has no routing rule.
     *
     * Idempotent: a later call with the same hostname replaces the rule.
     *
     * @param service   e.g. `http://deployer:3000` (the web entry the tunnel
     *                  frontends, resolved from the cloudflared container's
     *                  network).
     */
    const configureIngress = Effect.fn(
        'CloudflareTunnelService.configureIngress'
    )(function* (
        providerId: string,
        tunnelId: string,
        hostname: string,
        service: string
    ) {
        const { client, accountId } = yield* clientFor(providerId)
        const preserved = yield* applyIngressRules(
            client,
            accountId,
            tunnelId,
            hostname,
            service
        ).pipe(
            // Like every sibling method here, the SDK's own error type is converted
            // at the boundary. Letting it escape made an ordinary "Cloudflare refused
            // this configuration" rejection surface as a bare 500 with no reason
            // attached, which is how the 1056 ingress failure stayed unexplained.
            Effect.catch((err) => {
                const message = toCloudflareErrorMessage(err)
                return Effect.logError(
                    `configureIngress failed for tunnel ${tunnelId} (${hostname} → ${service}): ${message}`
                ).pipe(
                    Effect.andThen(
                        Effect.fail(
                            new BadGatewayException(
                                `Could not configure the tunnel's routing for ${hostname}: ${message}`,
                                { cause: err }
                            )
                        )
                    )
                )
            })
        )
        yield* Effect.logInfo(
            `Tunnel ${tunnelId} ingress configured: ${hostname} → ${service} (${String(preserved)} other hostname rule(s) preserved)`
        )
    })

    /**
     * Remove the CNAME a tunnel owned (when a hostname is known), so deleting the tunnel does not
     * leave an orphan record pointing at a dead `{tunnelId}.cfargotunnel.com`. The tunnel is gone
     * regardless; the orphan CNAME is a cosmetic cleanup — surface it but do not fail the deletion.
     */
    const removeTunnelCname = (
        providerId: string,
        tunnelId: string,
        hostname: string
    ) =>
        Effect.gen(function* () {
            const zone = yield* dns.findZoneForHostname(
                { providerId, providerType: 'cloudflare' },
                hostname
            )
            if (!zone) return
            const records = yield* dns.listRecords(
                { providerId, providerType: 'cloudflare' },
                zone.zoneId
            )
            const cname = records.find(
                (r) =>
                    r.type === 'CNAME' &&
                    r.name.toLowerCase() === hostname.toLowerCase()
            )
            if (!cname) return
            yield* dns.deleteRecord(
                { providerId, providerType: 'cloudflare' },
                zone.zoneId,
                cname.id
            )
            yield* Effect.logInfo(
                `Deleted CNAME ${cname.name} (zone ${zone.zoneName}) for tunnel ${tunnelId}`
            )
        }).pipe(
            Effect.catch((err) =>
                Effect.logWarning(
                    `CNAME cleanup for tunnel ${tunnelId} failed: ${err instanceof Error ? err.message : String(err)}`
                )
            )
        )

    const deleteTunnel = Effect.fn('CloudflareTunnelService.deleteTunnel')(
        function* (
            providerId: string,
            tunnelId: string,
            opts?: { hostname?: string | null }
        ) {
            const { client, accountId } = yield* clientFor(providerId)
            yield* attempt(() =>
                client.zeroTrust.tunnels.cloudflared.delete(tunnelId, {
                    account_id: accountId,
                })
            )
            yield* Effect.logInfo(
                `Cloudflare tunnel ${tunnelId} deleted (provider ${providerId})`
            )

            const hostname = opts?.hostname?.trim()
            if (hostname)
                yield* removeTunnelCname(providerId, tunnelId, hostname)
            return true
        }
    )

    const getTunnelToken = Effect.fn('CloudflareTunnelService.getTunnelToken')(
        function* (providerId: string, tunnelId: string) {
            return yield* Effect.gen(function* () {
                const { client, accountId } = yield* clientFor(providerId)
                const token = yield* attempt(() =>
                    client.zeroTrust.tunnels.cloudflared.token.get(tunnelId, {
                        account_id: accountId,
                    })
                )
                return {
                    token: maskTunnelToken(token),
                    error: null as string | null,
                }
            }).pipe(
                Effect.catch((err) =>
                    Effect.logWarning(
                        `cloudflareGetTunnelToken failed for provider ${providerId}: ${err instanceof Error ? err.message : String(err)}`
                    ).pipe(
                        Effect.as({
                            token: null as string | null,
                            error: toCloudflareErrorMessage(err),
                        })
                    )
                )
            )
        }
    )

    /** Live tunnel health: Cloudflare status + active connection count. */
    const getTunnelHealth = Effect.fn(
        'CloudflareTunnelService.getTunnelHealth'
    )(function* (providerId: string, tunnelId: string) {
        type Health = {
            status: 'healthy' | 'degraded' | 'down' | 'inactive' | 'unknown'
            checkedAt: string
            connections: number
            error: string | null
        }
        return yield* Effect.gen(function* () {
            const { client, accountId } = yield* clientFor(providerId)
            const tunnel = yield* attempt(() =>
                client.zeroTrust.tunnels.cloudflared.get(tunnelId, {
                    account_id: accountId,
                })
            )
            const connections = yield* fetchConnections(
                client,
                accountId,
                tunnelId
            )
            const active = connections.filter(
                (c) => !c.isPendingReconnect
            ).length
            return {
                status: tunnel.status ?? 'unknown',
                checkedAt: new Date().toISOString(),
                connections: active,
                error: null,
            } satisfies Health
        }).pipe(
            Effect.catch((err) =>
                Effect.logWarning(
                    `cloudflareGetTunnelHealth failed for provider ${providerId}: ${err instanceof Error ? err.message : String(err)}`
                ).pipe(
                    Effect.as({
                        status: 'unknown',
                        checkedAt: new Date().toISOString(),
                        connections: 0,
                        error: toCloudflareErrorMessage(err),
                    } satisfies Health as Health)
                )
            )
        )
    })

    return {
        listTunnels,
        getTunnel,
        createTunnel,
        configureIngress,
        deleteTunnel,
        getTunnelToken,
        getTunnelHealth,
    }
}

export type CloudflareTunnelServiceShape = Over<
    ReturnType<typeof makeCloudflareTunnelService>,
    CloudflareAppService | CloudflareDnsProviderService
>

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class CloudflareTunnelService extends Context.Service<
    CloudflareTunnelService,
    CloudflareTunnelServiceShape
>()('fleet/CloudflareTunnelService') {
    /** The collaborators are yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live: CloudflareTunnelServiceShape = serviceOver(
        Effect.all({
            apps: CloudflareAppService,
            dns: CloudflareDnsProviderService,
        }),
        makeCloudflareTunnelService
    )
}

export type { TunnelShape }
