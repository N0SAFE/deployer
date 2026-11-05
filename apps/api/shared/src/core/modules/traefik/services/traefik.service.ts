import { Context, Effect } from 'effect'

import { ConfigNotFoundError } from '../errors'

import {
    verifySwarmRouteAgainstTraefik,
    type SwarmRouteVerifyOptions,
} from './swarm-route-verifier'

import type { TraefikFileSystemShape } from './traefik-file-system.service'
import type { TraefikSyncShape } from './traefik-sync.service'
import type {
    CreateServiceConfigInput,
    UpdateServiceConfigInput,
    CreateDomainRouteInput,
    CreateServiceTargetInput,
    CreateSSLCertificateInput,
    CreateMiddlewareInput,
    SyncSummary,
    ValidationError,
    ValidationResult,
} from '../interfaces'
import type { TraefikRepositoryShape } from '../repositories/traefik.repository'

type Ports = {
    readonly repository: TraefikRepositoryShape
    readonly fileSystem: TraefikFileSystemShape
    readonly sync: TraefikSyncShape
}

/**
 * The Traefik facade: the database is the source of truth (configs, routes, targets, certificates, middlewares), the
 * virtual filesystem shows it as files, and sync writes it where Traefik reads it. Every member is an Effect that fails
 * with `StorageFailure` (database), `ConfigNotFoundError` (a missing config) or the sync/filesystem failures.
 */
export function makeTraefikService({ repository, fileSystem, sync }: Ports) {
    const syncServiceConfiguration = (serviceId: string) =>
        Effect.gen(function* () {
            const config =
                yield* repository.getServiceConfigByServiceId(serviceId)
            if (!config)
                return yield* new ConfigNotFoundError({
                    configId: serviceId,
                    configType: 'service',
                })
            return yield* sync.syncServiceConfiguration(config.id)
        })

    return {
        // ── service configurations (source of truth) ──────────────────────────────────────────────────────────────────
        createServiceConfiguration: (
            serviceId: string,
            config: Omit<CreateServiceConfigInput, 'serviceId'>
        ) =>
            Effect.logDebug(
                `Creating service configuration for service ${serviceId}`
            ).pipe(
                Effect.andThen(
                    repository.createServiceConfig({ serviceId, ...config })
                )
            ),
        getServiceConfiguration: (configId: string) =>
            repository.getCompleteServiceConfig(configId),
        updateServiceConfiguration: (
            configId: string,
            updates: Omit<UpdateServiceConfigInput, 'id'>
        ) =>
            Effect.logDebug(`Updating service configuration ${configId}`).pipe(
                Effect.andThen(
                    repository.updateServiceConfig({ id: configId, ...updates })
                )
            ),
        deleteServiceConfiguration: (configId: string) =>
            Effect.logDebug(`Deleting service configuration ${configId}`).pipe(
                Effect.andThen(repository.deleteServiceConfig(configId))
            ),
        getAllServiceConfigurations: (isActive?: boolean) =>
            repository.getAllServiceConfigs(isActive),

        // ── domain routes ─────────────────────────────────────────────────────────────────────────────────────────────
        addDomainRoute: (
            configId: string,
            routeConfig: Omit<CreateDomainRouteInput, 'configId'>
        ) => repository.createDomainRoute({ configId, ...routeConfig }),
        updateDomainRoute: (
            routeId: string,
            updates: Partial<Omit<CreateDomainRouteInput, 'configId'>>
        ) => repository.updateDomainRoute(routeId, updates),
        deleteDomainRoute: (routeId: string) =>
            repository.deleteDomainRoute(routeId),

        // ── service targets ───────────────────────────────────────────────────────────────────────────────────────────
        addServiceTarget: (
            configId: string,
            targetConfig: Omit<CreateServiceTargetInput, 'configId'>
        ) => repository.createServiceTarget({ configId, ...targetConfig }),
        updateServiceTarget: (
            targetId: string,
            updates: Partial<Omit<CreateServiceTargetInput, 'configId'>>
        ) => repository.updateServiceTarget(targetId, updates),
        deleteServiceTarget: (targetId: string) =>
            repository.deleteServiceTarget(targetId),

        // ── SSL certificates ──────────────────────────────────────────────────────────────────────────────────────────
        addSSLCertificate: (
            configId: string,
            certConfig: Omit<CreateSSLCertificateInput, 'configId'>
        ) => repository.createSSLCertificate({ configId, ...certConfig }),
        updateSSLCertificate: (
            certId: string,
            updates: Partial<Omit<CreateSSLCertificateInput, 'configId'>>
        ) => repository.updateSSLCertificate(certId, updates),
        deleteSSLCertificate: (certId: string) =>
            repository.deleteSSLCertificate(certId),

        // ── middlewares ───────────────────────────────────────────────────────────────────────────────────────────────
        createMiddleware: (middlewareConfig: CreateMiddlewareInput) =>
            repository.createMiddleware(middlewareConfig),
        getMiddlewares: (serviceId?: string, isGlobal?: boolean) =>
            repository.getMiddlewares(serviceId, isGlobal, true),
        updateMiddleware: (
            middlewareId: string,
            updates: Partial<Omit<CreateMiddlewareInput, 'serviceId'>>
        ) => repository.updateMiddleware(middlewareId, updates),
        deleteMiddleware: (middlewareId: string) =>
            repository.deleteMiddleware(middlewareId),

        // ── filesystem (read-only access to the virtual tree) ─────────────────────────────────────────────────────────
        getTraefikFileSystem: (path?: string) =>
            fileSystem.getTraefikFileSystem(path),
        getProjectFileSystem: (projectName: string) =>
            fileSystem.getProjectFileSystem(projectName),
        getFileContent: (filePath: string) =>
            fileSystem.getFileContent(filePath),
        downloadFile: (filePath: string) => fileSystem.downloadFile(filePath),
        listProjects: () => fileSystem.listProjects(),

        // ── synchronisation (database → filesystem) ───────────────────────────────────────────────────────────────────
        /** `ConfigNotFoundError` when the service has no Traefik config yet; a failed write is a `success: false` result. */
        syncServiceConfiguration,
        syncAllConfigurations: (): Effect.Effect<
            SyncSummary,
            import('../../database/storage').StorageFailure
        > => sync.syncAllConfigurations(),
        /** Sync one project's changed configurations, or every changed configuration without a project name. */
        forceSyncAll: (projectName?: string) =>
            (projectName
                ? sync.syncProjectConfigurations(projectName)
                : sync.syncAllConfigurations()
            ).pipe(
                Effect.map((result) => ({
                    total: result.total,
                    successful: result.successful,
                    failed: result.failed,
                    results: result.results.map((r) => ({
                        configId: r.configId,
                        configName: r.configName,
                        success: r.success,
                        action: r.action,
                        message: r.message,
                    })),
                }))
            ),
        cleanupOrphanedFiles: (projectName?: string) =>
            projectName
                ? sync.cleanupOrphanedFilesForProject(projectName)
                : sync.cleanupOrphanedFiles(),

        // ── high-level operations ─────────────────────────────────────────────────────────────────────────────────────
        /** Create or update a service's configuration, then sync it. */
        deployServiceConfiguration: (
            serviceId: string,
            config: Omit<CreateServiceConfigInput, 'serviceId'>
        ) =>
            Effect.gen(function* () {
                yield* Effect.logInfo(
                    `Deploying service configuration for ${serviceId}`
                )
                const existing =
                    yield* repository.getServiceConfigByServiceId(serviceId)
                const serviceConfig = existing
                    ? yield* repository.updateServiceConfig({
                          id: existing.id,
                          ...config,
                      })
                    : yield* repository.createServiceConfig({
                          serviceId,
                          ...config,
                      })
                const syncResult = yield* sync.syncServiceConfiguration(
                    serviceConfig?.id ?? ''
                )
                yield* Effect.logInfo(
                    `Service configuration deployed for ${serviceId}: ${syncResult.success ? 'success' : 'failed'}`
                )
                return { configuration: serviceConfig, syncResult }
            }),
        /** Deactivate a service's configuration and clean up the files nothing owns any more. */
        removeServiceConfiguration: (serviceId: string) =>
            Effect.gen(function* () {
                yield* Effect.logInfo(
                    `Removing service configuration for ${serviceId}`
                )
                const config =
                    yield* repository.getServiceConfigByServiceId(serviceId)
                if (!config)
                    return yield* new ConfigNotFoundError({
                        configId: serviceId,
                        configType: 'service',
                    })
                yield* repository.updateServiceConfig({
                    id: config.id,
                    isActive: false,
                })
                yield* sync.cleanupOrphanedFiles()
                yield* Effect.logInfo(
                    `Service configuration removed for ${serviceId}`
                )
                return {
                    success: true,
                    message: 'Service configuration removed successfully',
                }
            }),

        /** Check a stored configuration (domain, port, targets, SSL provider). `ConfigNotFoundError` when it does not exist. */
        validateConfiguration: (configId: string) =>
            Effect.gen(function* () {
                const config =
                    yield* repository.getCompleteServiceConfig(configId)
                if (!config)
                    return yield* new ConfigNotFoundError({
                        configId,
                        configType: 'configuration',
                    })

                const errors: ValidationError[] = []
                const warnings: { path: string; message: string }[] = []

                if (!config.domain)
                    errors.push({
                        path: 'domain',
                        message: 'Domain is required',
                        code: 'MISSING_DOMAIN',
                    })
                if (!config.port || config.port < 1 || config.port > 65535) {
                    errors.push({
                        path: 'port',
                        message: 'Valid port number is required (1-65535)',
                        code: 'INVALID_PORT',
                    })
                }
                const serviceTargets = config.serviceTargets as
                    unknown[] | undefined
                if (!serviceTargets || serviceTargets.length === 0) {
                    warnings.push({
                        path: 'serviceTargets',
                        message:
                            'No service targets configured - will use default localhost target',
                    })
                }
                const validSslProviders = [
                    'letsencrypt',
                    'selfsigned',
                    'custom',
                ]
                if (
                    config.sslEnabled &&
                    (!config.sslProvider ||
                        !validSslProviders.includes(config.sslProvider))
                ) {
                    errors.push({
                        path: 'sslProvider',
                        message:
                            'Valid SSL provider is required when SSL is enabled',
                        code: 'INVALID_SSL_PROVIDER',
                    })
                }

                if (errors.length > 0) {
                    yield* Effect.logWarning(
                        `Configuration ${configId} validation failed with ${String(errors.length)} error(s)`
                    )
                }
                return {
                    isValid: errors.length === 0,
                    errors,
                    warnings,
                } satisfies ValidationResult
            }),
        getHealthStatus: () => repository.getHealthCheckSummary(),

        /**
         * Verify-only mode for Swarm-managed services (SW-023): probes the Traefik API for a router matching the host rule.
         * Traefik converges routes from the service labels itself, so this verifies and never writes config. Never fails:
         * an unreachable Traefik API yields `verified: false`.
         */
        verifySwarmServiceRoute: (
            hostRule: string,
            options?: SwarmRouteVerifyOptions
        ) =>
            Effect.promise(() =>
                verifySwarmRouteAgainstTraefik(hostRule, options)
            ),
    }
}

export type TraefikServiceShape = ReturnType<typeof makeTraefikService>

export class TraefikService extends Context.Service<
    TraefikService,
    TraefikServiceShape
>()('shared/TraefikService') {}
