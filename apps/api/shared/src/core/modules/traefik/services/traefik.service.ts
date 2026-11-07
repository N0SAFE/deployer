import { Context, Effect } from 'effect'

import { ConfigNotFoundError } from '../errors'
import { TraefikRepository } from '../repositories/traefik.repository'

import {
    verifySwarmRouteAgainstTraefik,
    type SwarmRouteVerifyOptions,
} from './swarm-route-verifier'
import { TraefikFileSystemService } from './traefik-file-system.service'
import { TraefikSyncService } from './traefik-sync.service'

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

/** The shapes this facade answers with, read off the collaborators instead of restated. */
type RepositoryShape = Context.Service.Shape<typeof TraefikRepository>
type FileSystemShape = Context.Service.Shape<typeof TraefikFileSystemService>
type SyncShape = Context.Service.Shape<typeof TraefikSyncService>

type ConfigResult = Effect.Success<
    ReturnType<RepositoryShape['createServiceConfig']>
>
type MiddlewareList = Effect.Success<
    ReturnType<RepositoryShape['getMiddlewares']>
>
type HealthSummary = Effect.Success<
    ReturnType<RepositoryShape['getHealthCheckSummary']>
>
type SyncResult = Effect.Success<
    ReturnType<SyncShape['syncServiceConfiguration']>
>

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * Every member IS the logic: the collaborator it needs is yielded in that member. The filesystem members yield
 * `TraefikFileSystemService` because the virtual tree is that service's job — this facade exposes it, it does not
 * re-implement it.
 */
class TraefikServiceImpl {
        createServiceConfiguration(
            serviceId: string,
            config: Omit<CreateServiceConfigInput, 'serviceId'>
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                yield* Effect.logDebug(
                    `Creating service configuration for service ${serviceId}`
                )
                return yield* repository.createServiceConfig({
                    serviceId,
                    ...config,
                })
            })
        }

        getServiceConfiguration(
            configId: string
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.getCompleteServiceConfig(configId)
            })
        }

        updateServiceConfiguration(
            configId: string,
            updates: Omit<UpdateServiceConfigInput, 'id'>
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                yield* Effect.logDebug(
                    `Updating service configuration ${configId}`
                )
                return yield* repository.updateServiceConfig({
                    id: configId,
                    ...updates,
                })
            })
        }

        deleteServiceConfiguration(
            configId: string
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                yield* Effect.logDebug(
                    `Deleting service configuration ${configId}`
                )
                return yield* repository.deleteServiceConfig(configId)
            })
        }

        getAllServiceConfigurations(
            isActive?: boolean
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.getAllServiceConfigs(isActive)
            })
        }

        addDomainRoute(
            configId: string,
            routeConfig: Omit<CreateDomainRouteInput, 'configId'>
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.createDomainRoute({
                    configId,
                    ...routeConfig,
                })
            })
        }

        updateDomainRoute(
            routeId: string,
            updates: Partial<Omit<CreateDomainRouteInput, 'configId'>>
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.updateDomainRoute(routeId, updates)
            })
        }

        deleteDomainRoute(
            routeId: string
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.deleteDomainRoute(routeId)
            })
        }

        addServiceTarget(
            configId: string,
            targetConfig: Omit<CreateServiceTargetInput, 'configId'>
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.createServiceTarget({
                    configId,
                    ...targetConfig,
                })
            })
        }

        updateServiceTarget(
            targetId: string,
            updates: Partial<Omit<CreateServiceTargetInput, 'configId'>>
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.updateServiceTarget(targetId, updates)
            })
        }

        deleteServiceTarget(
            targetId: string
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.deleteServiceTarget(targetId)
            })
        }

        addSSLCertificate(
            configId: string,
            certConfig: Omit<CreateSSLCertificateInput, 'configId'>
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.createSSLCertificate({
                    configId,
                    ...certConfig,
                })
            })
        }

        updateSSLCertificate(
            certId: string,
            updates: Partial<Omit<CreateSSLCertificateInput, 'configId'>>
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.updateSSLCertificate(certId, updates)
            })
        }

        deleteSSLCertificate(
            certId: string
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.deleteSSLCertificate(certId)
            })
        }

        createMiddleware(
            middlewareConfig: CreateMiddlewareInput
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.createMiddleware(middlewareConfig)
            })
        }

        getMiddlewares(serviceId?: string, isGlobal?: boolean) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.getMiddlewares(
                    serviceId,
                    isGlobal,
                    true
                )
            })
        }

        updateMiddleware(
            middlewareId: string,
            updates: Partial<Omit<CreateMiddlewareInput, 'serviceId'>>
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.updateMiddleware(
                    middlewareId,
                    updates
                )
            })
        }

        deleteMiddleware(
            middlewareId: string
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.deleteMiddleware(middlewareId)
            })
        }

        getTraefikFileSystem(
            path?: string
        ) {
            return Effect.gen(function* () {
                const fileSystem = yield* TraefikFileSystemService
                return yield* fileSystem.getTraefikFileSystem(path)
            })
        }

        getProjectFileSystem(
            projectName: string
        ) {
            return Effect.gen(function* () {
                const fileSystem = yield* TraefikFileSystemService
                return yield* fileSystem.getProjectFileSystem(projectName)
            })
        }

        getFileContent(
            filePath: string
        ) {
            return Effect.gen(function* () {
                const fileSystem = yield* TraefikFileSystemService
                return yield* fileSystem.getFileContent(filePath)
            })
        }

        downloadFile(
            filePath: string
        ) {
            return Effect.gen(function* () {
                const fileSystem = yield* TraefikFileSystemService
                return yield* fileSystem.downloadFile(filePath)
            })
        }

        listProjects() {
            return Effect.gen(function* () {
                const fileSystem = yield* TraefikFileSystemService
                return yield* fileSystem.listProjects()
            })
        }

        syncServiceConfiguration(
            serviceId: string
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                const sync = yield* TraefikSyncService
                const config =
                    yield* repository.getServiceConfigByServiceId(serviceId)
                if (!config)
                    return yield* new ConfigNotFoundError({
                        configId: serviceId,
                        configType: 'service',
                    })
                return yield* sync.syncServiceConfiguration(config.id)
            })
        }

        syncAllConfigurations() {
            return Effect.gen(function* () {
                const sync = yield* TraefikSyncService
                return yield* sync.syncAllConfigurations()
            })
        }

        /** Sync one project's changed configurations, or every changed configuration without a project name. */
        forceSyncAll(projectName?: string) {
            return Effect.gen(function* () {
                const sync = yield* TraefikSyncService
                return yield* projectName === undefined
                    ? sync.syncAllConfigurations()
                    : sync.syncProjectConfigurations(projectName)
            })
        }

        cleanupOrphanedFiles(
            projectName?: string
        ) {
            return Effect.gen(function* () {
                const sync = yield* TraefikSyncService
                return yield* projectName === undefined
                    ? sync.cleanupOrphanedFiles()
                    : sync.cleanupOrphanedFilesForProject(projectName)
            })
        }

        deployServiceConfiguration(
            serviceId: string,
            config: Omit<CreateServiceConfigInput, 'serviceId'>
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                const sync = yield* TraefikSyncService
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
                // A write that returned no row has nothing to sync: saying so beats syncing an empty id.
                if (!serviceConfig)
                    return yield* new ConfigNotFoundError({
                        configId: serviceId,
                        configType: 'service',
                    })
                const syncResult = yield* sync.syncServiceConfiguration(
                    serviceConfig.id
                )
                yield* Effect.logInfo(
                    `Service configuration deployed for ${serviceId}: ${syncResult.success ? 'success' : 'failed'}`
                )
                return { configuration: serviceConfig, syncResult }
            })
        }

        removeServiceConfiguration(
            serviceId: string
        ) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                const sync = yield* TraefikSyncService
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
            })
        }

        validateConfiguration(configId: string) {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
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
                if (config.serviceTargets.length === 0) {
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
            })
        }

        getHealthStatus() {
            return Effect.gen(function* () {
                const repository = yield* TraefikRepository
                return yield* repository.getHealthCheckSummary()
            })
        }

        verifySwarmServiceRoute(
            hostRule: string,
            options?: SwarmRouteVerifyOptions
        ) {
            return Effect.promise(() =>
                verifySwarmRouteAgainstTraefik(hostRule, options)
            )
        }
}

export type TraefikServiceShape = TraefikServiceImpl

export class TraefikService extends Context.Service<
    TraefikService,
    TraefikServiceShape
>()('shared/TraefikService') {
    static readonly live = TraefikServiceImpl
}
