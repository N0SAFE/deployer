/**
 * Domain Routing Service
 *
 * Bridges the domain module (service_domain_mappings) and the Traefik routing engine. A service's reachable URLs are
 * derived ENTIRELY from its domain mappings (project domain + subdomain + basePath) — never from environment variables.
 *
 *  - resolveServiceUrls: map a service's bindings → structured reachable URLs
 *  - resolvePrimaryUrl: the primary URL for a deployment (domainUrl)
 *  - syncServiceRoutes: upsert traefik service config + domain routes from the mappings and sync them to the filesystem
 *
 * Traefik template variables (`~##domain##~`, `~##subdomain##~`, …) are resolved from the mapping-derived context.
 */
import { Context, Effect } from 'effect'

import { TraefikRepository } from '../../traefik/repositories/traefik.repository'
import { TraefikSyncService } from '../../traefik/services/traefik-sync.service'
import { TraefikVariableResolverService } from '../../traefik/services/traefik-variable-resolver.service'
import { TraefikService } from '../../traefik/services/traefik.service'
import { DomainRoutingFailure } from '../errors'
import { ServiceDomainMappingRepository } from '../repositories/service-domain-mapping.repository'

import type { DatabasePort, StorageFailure } from '../../database/storage'
import type { TraefikFileSystemService } from '../../traefik/services/traefik-file-system.service'

export type ResolvedServiceUrl = {
    mappingId: string
    /** hostname only, e.g. "api.example.com" or "example.com" */
    host: string
    /** base domain, e.g. "example.com" */
    domain: string
    /** subdomain label, e.g. "api", or null for root */
    subdomain: string | null
    /** URL path prefix, e.g. "/v1", or null */
    basePath: string | null
    /** full URL, e.g. "https://api.example.com/v1" */
    fullUrl: string
    isPrimary: boolean
    sslEnabled: boolean
    sslProvider: 'letsencrypt' | 'custom' | 'none'
}

export type RouteSyncResult = {
    success: boolean
    reason?: string
    urls: ResolvedServiceUrl[]
    primaryUrl: string | null
    configId?: string
}

type Failure = StorageFailure | DomainRoutingFailure

export type DomainRoutingServiceShape = {
    /** Every reachable URL of a service, from its domain mappings. Pure read. */
    readonly resolveServiceUrls: (
        serviceId: string
    ) => Effect.Effect<
        ResolvedServiceUrl[],
        StorageFailure,
        ServiceDomainMappingRepository | DatabasePort
    >
    /** The primary URL (isPrimary mapping, else the first); `null` when the service has no mapping. */
    readonly resolvePrimaryUrl: (
        serviceId: string
    ) => Effect.Effect<
        string | null,
        StorageFailure,
        ServiceDomainMappingRepository | DatabasePort
    >
    /** Traefik template variables for a service's primary URL context (raw → resolved). */
    readonly buildVariableMap: (
        serviceId: string,
        primary: ResolvedServiceUrl | null,
        options?: {
            pathPrefix?: string | null
            healthCheckPath?: string | null
        }
    ) => Effect.Effect<
        Record<string, string>,
        never,
        TraefikVariableResolverService
    >
    /** Upsert the traefik service config and domain routes from the mappings, then sync to the filesystem. Idempotent. */
    readonly syncServiceRoutes: (
        serviceId: string,
        options?: { port?: number; healthCheckPath?: string | null }
    ) => Effect.Effect<
        RouteSyncResult,
        Failure,
        | ServiceDomainMappingRepository
        | TraefikRepository
        | TraefikSyncService
        | TraefikVariableResolverService
        | TraefikFileSystemService
        | DatabasePort
    >
    /** Register an SSL certificate for the primary host when its mapping has SSL on. Idempotent. */
    readonly provisionTlsCertificate: (
        serviceId: string
    ) => Effect.Effect<
        { provisioned: boolean; host: string | null; reason?: string },
        Failure,
        | ServiceDomainMappingRepository
        | TraefikRepository
        | TraefikService
        | DatabasePort
    >
    /** Add a temporary preview route without touching the stable ones. `null` when there is nowhere to put it. */
    readonly addPreviewRoute: (
        serviceId: string,
        host: string,
        options?: { sslEnabled?: boolean }
    ) => Effect.Effect<
        { configId: string; routeId: string } | null,
        StorageFailure,
        TraefikRepository | DatabasePort
    >
    /** Deactivate a preview route; whether one was found. */
    readonly removePreviewRoute: (
        serviceId: string,
        host: string
    ) => Effect.Effect<
        boolean,
        StorageFailure,
        TraefikRepository | DatabasePort
    >
    /** Turn a preview into a permanent mapping (subdomain = preview name) and re-sync. Idempotent. */
    readonly promotePreviewToStable: (
        serviceId: string,
        previewName: string
    ) => Effect.Effect<
        {
            promoted: boolean
            host: string | null
            reason?: string
            mappingId?: string
        },
        Failure,
        | ServiceDomainMappingRepository
        | TraefikRepository
        | TraefikSyncService
        | TraefikVariableResolverService
        | TraefikFileSystemService
        | DatabasePort
    >
}

const normalizeBasePath = (basePath: string): string => {
    const trimmed = basePath.trim()
    if (!trimmed || trimmed === '/') return ''
    return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

const extractHostFromRule = (hostRule: string): string | null =>
    /^Host\(`(.+)`\)$/.exec(hostRule.trim())?.[1] ?? null

const pickPrimary = (
    urls: ResolvedServiceUrl[]
): ResolvedServiceUrl | undefined => urls.find((u) => u.isPrimary) ?? urls[0]

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * Every method yields the collaborator it needs from the Effect context while it runs, so the class carries no
 * constructor dependency and the module provides it with `useClass`.
 */
export class DomainRoutingService extends Context.Service<
    DomainRoutingService,
    DomainRoutingServiceShape
>()('shared/DomainRoutingService') {
    static readonly live = class DomainRoutingServiceImpl
        implements DomainRoutingServiceShape
    {
        resolveServiceUrls(
            serviceId: string
        ): ReturnType<DomainRoutingServiceShape['resolveServiceUrls']> {
            return Effect.gen(function* () {
                const mappings = yield* ServiceDomainMappingRepository
                return yield* mappings.findServiceUrlRows(serviceId).pipe(
                    Effect.map((rows) =>
                        rows.map((row): ResolvedServiceUrl => {
                            const subdomain = row.subdomain?.trim()
                                ? row.subdomain.trim()
                                : null
                            const basePath = row.basePath?.trim()
                                ? normalizeBasePath(row.basePath)
                                : null
                            const host = subdomain
                                ? `${subdomain}.${row.orgDomain}`
                                : row.orgDomain
                            return {
                                mappingId: row.mappingId,
                                host,
                                domain: row.orgDomain,
                                subdomain,
                                basePath,
                                fullUrl: `https://${host}${basePath ?? ''}`,
                                isPrimary: row.isPrimary,
                                sslEnabled: row.sslEnabled,
                                sslProvider:
                                    row.sslProvider === 'custom' ||
                                    row.sslProvider === 'none'
                                        ? row.sslProvider
                                        : 'letsencrypt',
                            }
                        })
                    )
                )
            })
        }

        buildVariableMap(
            _serviceId: string,
            primary: ResolvedServiceUrl | null,
            options?: {
                pathPrefix?: string | null
                healthCheckPath?: string | null
            }
        ): ReturnType<DomainRoutingServiceShape['buildVariableMap']> {
            return Effect.gen(function* () {
                const variables = yield* TraefikVariableResolverService
                return variables.buildVariableMap({
                    domain: primary
                        ? {
                              domain: primary.domain,
                              subdomain: primary.subdomain ?? undefined,
                              fullDomain: primary.host,
                              baseDomain: primary.domain,
                          }
                        : undefined,
                    path: {
                        prefix:
                            options?.pathPrefix ??
                            primary?.basePath ??
                            undefined,
                        healthCheck: options?.healthCheckPath ?? '/health',
                    },
                })
            })
        }

        syncServiceRoutes(
            serviceId: string,
            options?: { port?: number; healthCheckPath?: string | null }
        ): ReturnType<DomainRoutingServiceShape['syncServiceRoutes']> {
            return Effect.gen({ self: this }, function* () {
                const traefikRepository = yield* TraefikRepository
                const traefikSync = yield* TraefikSyncService
                const urls = yield* this.resolveServiceUrls(serviceId)
                const primary = pickPrimary(urls)
                if (primary === undefined)
                    return {
                        success: false,
                        reason: 'no_domain_mappings',
                        urls: [],
                        primaryUrl: null,
                    }

                const port = options?.port ?? 80
                const healthCheck = {
                    enabled: true,
                    path: options?.healthCheckPath ?? '/health',
                }
                const sslProvider =
                    primary.sslProvider === 'none'
                        ? undefined
                        : primary.sslProvider

                // Find or create the traefik service config (unique per serviceId).
                let config =
                    yield* traefikRepository.getServiceConfigByServiceId(
                        serviceId
                    )
                if (!config) {
                    yield* traefikRepository.createServiceConfig({
                        serviceId,
                        domain: primary.domain,
                        subdomain: primary.subdomain ?? undefined,
                        port,
                        sslEnabled: primary.sslEnabled,
                        sslProvider,
                        pathPrefix: primary.basePath ?? '/',
                        healthCheck,
                        isActive: true,
                    })
                    config =
                        yield* traefikRepository.getServiceConfigByServiceId(
                            serviceId
                        )
                    if (!config) {
                        return yield* new DomainRoutingFailure({
                            operation: `create the traefik config for service ${serviceId}`,
                        })
                    }
                } else {
                    const existing = config
                    yield* traefikRepository.updateServiceConfig({
                        id: existing.id,
                        domain: primary.domain,
                        subdomain: primary.subdomain ?? undefined,
                        fullDomain: primary.host,
                        port,
                        sslEnabled: primary.sslEnabled,
                        sslProvider,
                        pathPrefix: primary.basePath ?? '/',
                        healthCheck,
                        isActive: true,
                    })
                }
                const configId = config.id

                // Existing routes, keyed by host for upsert.
                const existingRoutes =
                    yield* traefikRepository.getDomainRoutesByConfigId(
                        configId,
                        undefined
                    )
                const existingByHost = new Map<
                    string,
                    { id: string; hostRule: string }
                >()
                for (const route of existingRoutes) {
                    const host = extractHostFromRule(route.hostRule)
                    if (host) existingByHost.set(host, route)
                }

                const seenHosts = new Set<string>()
                for (const url of urls) {
                    const route = {
                        hostRule: `Host(\`${url.host}\`)`,
                        pathRule: url.basePath
                            ? `PathPrefix(\`${url.basePath}\`)`
                            : undefined,
                        entryPoint: url.sslEnabled ? 'websecure' : 'web',
                        priority: url.isPrimary ? 100 : 10,
                        isActive: true,
                    }
                    const existing = existingByHost.get(url.host)
                    yield* existing
                        ? traefikRepository.updateDomainRoute(
                              existing.id,
                              route
                          )
                        : traefikRepository.createDomainRoute({
                              configId,
                              ...route,
                          })
                    seenHosts.add(url.host)
                }

                // Deactivate routes whose host is no longer mapped.
                for (const [host, route] of existingByHost) {
                    if (!seenHosts.has(host))
                        yield* traefikRepository.updateDomainRoute(route.id, {
                            isActive: false,
                        })
                }

                const variableMap = yield* this.buildVariableMap(
                    serviceId,
                    primary,
                    {
                        pathPrefix: primary.basePath,
                        healthCheckPath: options?.healthCheckPath,
                    }
                )
                yield* Effect.logInfo(
                    `Domain routes synced for service ${serviceId} (${String(urls.length)} mappings, ${String(Object.keys(variableMap).length)} variables resolved)`
                )
                yield* traefikSync.syncServiceConfiguration(configId)

                return {
                    success: true,
                    urls,
                    primaryUrl: primary.fullUrl,
                    configId,
                }
            })
        }

        resolvePrimaryUrl(
            serviceId: string
        ): ReturnType<DomainRoutingServiceShape['resolvePrimaryUrl']> {
            return Effect.gen({ self: this }, function* () {
                const urls = yield* this.resolveServiceUrls(serviceId)
                return pickPrimary(urls)?.fullUrl ?? null
            })
        }

        provisionTlsCertificate(
            serviceId: string
        ): ReturnType<DomainRoutingServiceShape['provisionTlsCertificate']> {
            return Effect.gen({ self: this }, function* () {
                const traefikRepository = yield* TraefikRepository
                const certificates = yield* TraefikService

                const primary = pickPrimary(
                    yield* this.resolveServiceUrls(serviceId)
                )
                if (!primary)
                    return {
                        provisioned: false,
                        host: null,
                        reason: 'no_domain_mapping',
                    }
                if (!primary.sslEnabled || primary.sslProvider === 'none')
                    return {
                        provisioned: false,
                        host: primary.host,
                        reason: 'ssl_disabled',
                    }

                const config =
                    yield* traefikRepository.getServiceConfigByServiceId(
                        serviceId
                    )
                if (!config)
                    return {
                        provisioned: false,
                        host: primary.host,
                        reason: 'no_traefik_config',
                    }

                // Idempotency: skip if a cert for this host already exists.
                const existing =
                    yield* traefikRepository.getSSLCertificatesByConfigId(
                        config.id,
                        undefined
                    )
                if (existing.some((cert) => cert.domain === primary.host))
                    return {
                        provisioned: true,
                        host: primary.host,
                        reason: 'already_provisioned',
                    }

                yield* certificates.addSSLCertificate(config.id, {
                    domain: primary.host,
                    subjectAltNames: primary.subdomain
                        ? [primary.domain]
                        : undefined,
                    issuer:
                        primary.sslProvider === 'custom'
                            ? 'custom'
                            : 'letsencrypt',
                    autoRenew: primary.sslProvider !== 'custom',
                    renewalThreshold: 30,
                    isActive: true,
                })
                yield* Effect.logInfo(
                    `TLS certificate provisioned for ${primary.host} (provider=${primary.sslProvider})`
                )
                return { provisioned: true, host: primary.host }
            })
        }

        addPreviewRoute(
            serviceId: string,
            host: string,
            options?: { sslEnabled?: boolean }
        ): ReturnType<DomainRoutingServiceShape['addPreviewRoute']> {
            return Effect.gen(function* () {
                const traefikRepository = yield* TraefikRepository

                const found =
                    yield* traefikRepository.getServiceConfigByServiceId(
                        serviceId
                    )
                if (!found) {
                    // Stable routes not yet synced: create a minimal config so the preview route has a home.
                    const domain = host.includes('.')
                        ? host.split('.').slice(-2).join('.')
                        : host
                    const subdomain = host.includes('.')
                        ? host.split('.').slice(0, -2).join('.')
                        : undefined
                    const created =
                        yield* traefikRepository.createServiceConfig({
                            serviceId,
                            domain,
                            subdomain,
                            port: 80,
                            sslEnabled: options?.sslEnabled ?? true,
                            sslProvider: 'letsencrypt',
                            pathPrefix: '/',
                            isActive: true,
                        })
                    if (!created) return null
                }
                const config =
                    yield* traefikRepository.getServiceConfigByServiceId(
                        serviceId
                    )
                if (!config) return null

                const routes =
                    yield* traefikRepository.getDomainRoutesByConfigId(
                        config.id,
                        undefined
                    )
                const existing = routes.find(
                    (r) => extractHostFromRule(r.hostRule) === host
                )
                if (existing) {
                    yield* traefikRepository.updateDomainRoute(existing.id, {
                        isActive: true,
                        entryPoint: 'websecure',
                        priority: 50,
                    })
                    return { configId: config.id, routeId: existing.id }
                }
                const route = yield* traefikRepository.createDomainRoute({
                    configId: config.id,
                    hostRule: `Host(\`${host}\`)`,
                    entryPoint: 'websecure',
                    priority: 50,
                    isActive: true,
                })
                return route ? { configId: config.id, routeId: route.id } : null
            })
        }

        removePreviewRoute(
            serviceId: string,
            host: string
        ): ReturnType<DomainRoutingServiceShape['removePreviewRoute']> {
            return Effect.gen(function* () {
                const traefikRepository = yield* TraefikRepository

                const config =
                    yield* traefikRepository.getServiceConfigByServiceId(
                        serviceId
                    )
                if (!config) return false
                const routes =
                    yield* traefikRepository.getDomainRoutesByConfigId(
                        config.id,
                        undefined
                    )
                const target = routes.find(
                    (r) => extractHostFromRule(r.hostRule) === host
                )
                if (!target) return false
                yield* traefikRepository.updateDomainRoute(target.id, {
                    isActive: false,
                })
                return true
            })
        }

        promotePreviewToStable(
            serviceId: string,
            previewName: string
        ): ReturnType<DomainRoutingServiceShape['promotePreviewToStable']> {
            return Effect.gen({ self: this }, function* () {
                const mappings = yield* ServiceDomainMappingRepository

                const primary = pickPrimary(
                    yield* this.resolveServiceUrls(serviceId)
                )
                if (!primary)
                    return {
                        promoted: false,
                        host: null,
                        reason: 'no_domain_mapping',
                    }

                const host = `${previewName}.${primary.domain}`
                // `resolveServiceUrls` does not carry the project-domain id.
                const projectDomainId =
                    yield* mappings.findProjectDomainIdByMappingId(
                        primary.mappingId
                    )
                if (!projectDomainId)
                    return {
                        promoted: false,
                        host,
                        reason: 'primary_mapping_missing',
                    }

                const duplicates = yield* mappings.findBySubdomain(
                    projectDomainId,
                    previewName
                )
                if (duplicates.length > 0)
                    return {
                        promoted: false,
                        host,
                        reason: 'subdomain_already_stable',
                    }

                const created = yield* mappings.create({
                    serviceId,
                    projectDomainId,
                    subdomain: previewName,
                    basePath: null,
                    isPrimary: false,
                    sslEnabled: true,
                    sslProvider: 'letsencrypt',
                })

                // Re-sync so the promoted host gets a stable route, superseding the preview route.
                yield* this.syncServiceRoutes(serviceId, {
                    healthCheckPath: '/health',
                })
                yield* mappings.deactivatePreviewEnvironmentsByFullDomain(host)

                yield* Effect.logInfo(
                    `Preview promoted to stable mapping: ${host} (service=${serviceId})`
                )
                return { promoted: true, host, mappingId: created.id }
            })
        }
    }
}
