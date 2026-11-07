import {
    eq,
    and,
    desc,
    asc,
    isNotNull,
    inArray,
    or,
    isNull,
    gt,
    SQL,
} from 'drizzle-orm'
import { Context, Effect } from 'effect'

import {
    services,
    projects,
} from '@deployer/nest-schema/global/project/deployment'
import {
    traefikServiceConfigs,
    traefikDomainRoutes,
    traefikServiceTargets,
    traefikConfigFiles,
    traefikMiddlewares,
    traefikSSLCertificates,
    traefikMiddleware,
    traefikPlugins,
    traefikStaticFiles,
    traefikBackups,
    traefikStaticConfigs,
    traefikConfigs,
    type CreateTraefikSslCertificate,
    type CreateTraefikMiddleware,
    type CreateTraefikPlugin,
    type CreateTraefikStaticFile,
    type CreateTraefikBackup,
} from '@deployer/nest-schema/global/traefik/index'

import { DatabasePort, storage } from '../../database/storage'

import type {
    CreateServiceConfigInput,
    UpdateServiceConfigInput,
    CreateDomainRouteInput,
    CreateServiceTargetInput,
    CreateSSLCertificateInput,
    CreateConfigFileInput,
    CreateMiddlewareInput,
} from '../interfaces'

/** The Traefik tables' data access. Every method yields `DatabasePort` when it runs and
 * fails with `StorageFailure`. */
class TraefikRepositoryImpl {
    getProjectIdByName(projectName: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [result] = await db
                    .select({ id: projects.id })
                    .from(projects)
                    .where(eq(projects.name, projectName))
                    .limit(1)

                return result?.id ?? null
            })
        })
    }

    createServiceConfig(input: CreateServiceConfigInput) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const fullDomain = input.subdomain
                    ? `${input.subdomain}.${input.domain}`
                    : input.domain

                const [config] = await db
                    .insert(traefikServiceConfigs)
                    .values({
                        ...input,
                        fullDomain,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning()

                return config ?? null
            })
        })
    }

    getServiceConfig(id: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [config] = await db
                    .select()
                    .from(traefikServiceConfigs)
                    .where(eq(traefikServiceConfigs.id, id))

                return config
            })
        })
    }

    getServiceConfigByServiceId(serviceId: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [config] = await db
                    .select()
                    .from(traefikServiceConfigs)
                    .where(eq(traefikServiceConfigs.serviceId, serviceId))

                return config
            })
        })
    }

    getAllServiceConfigs(isActive?: boolean) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const query = db
                    .select()
                    .from(traefikServiceConfigs)
                    .orderBy(desc(traefikServiceConfigs.createdAt))

                if (isActive !== undefined) {
                    query.where(eq(traefikServiceConfigs.isActive, isActive))
                }

                return await query
            })
        })
    }

    getServiceConfigsByDomain(domain: string, isActive?: boolean) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const conditions = [eq(traefikServiceConfigs.domain, domain)]

                if (isActive !== undefined) {
                    conditions.push(
                        eq(traefikServiceConfigs.isActive, isActive)
                    )
                }

                return await db
                    .select()
                    .from(traefikServiceConfigs)
                    .where(and(...conditions))
                    .orderBy(desc(traefikServiceConfigs.createdAt))
            })
        })
    }

    getServiceConfigsByProject(projectId: string, isActive?: boolean) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                // Get all services for the project first
                const projectServices = await db
                    .select({ id: services.id })
                    .from(services)
                    .where(eq(services.projectId, projectId))

                const serviceIds = projectServices.map((service) => service.id)

                if (serviceIds.length === 0) {
                    return []
                }

                // Get all Traefik configurations for these services
                const conditions = [
                    inArray(traefikServiceConfigs.serviceId, serviceIds),
                ]

                if (isActive !== undefined) {
                    conditions.push(
                        eq(traefikServiceConfigs.isActive, isActive)
                    )
                }

                return await db
                    .select()
                    .from(traefikServiceConfigs)
                    .where(and(...conditions))
                    .orderBy(desc(traefikServiceConfigs.createdAt))
            })
        })
    }

    deleteServiceConfig(id: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                // First delete dependent records to avoid foreign key constraints

                // Delete config files that reference this service config
                await db
                    .delete(traefikConfigFiles)
                    .where(eq(traefikConfigFiles.configId, id))

                // Delete domain routes that reference this service config
                await db
                    .delete(traefikDomainRoutes)
                    .where(eq(traefikDomainRoutes.configId, id))

                // Delete service targets that reference this service config
                await db
                    .delete(traefikServiceTargets)
                    .where(eq(traefikServiceTargets.configId, id))

                // Now delete the service config itself
                const [deletedConfig] = await db
                    .delete(traefikServiceConfigs)
                    .where(eq(traefikServiceConfigs.id, id))
                    .returning()

                return deletedConfig
            })
        })
    }

    updateConfigSyncStatus(configId: string, lastSyncedAt: Date) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [updated] = await db
                    .update(traefikServiceConfigs)
                    .set({
                        lastSyncedAt,
                        updatedAt: new Date(),
                    })
                    .where(eq(traefikServiceConfigs.id, configId))
                    .returning()

                return updated
            })
        })
    }

    /**
     * Update sync status for traefikConfigs table (virtual filesystem)
     */
    updateTraefikConfigSyncStatus(configId: string, lastSyncedAt: Date) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [updated] = await db
                    .update(traefikConfigs)
                    .set({
                        lastSyncedAt,
                        syncStatus: 'synced',
                        syncErrorMessage: null,
                        updatedAt: new Date(),
                    })
                    .where(eq(traefikConfigs.id, configId))
                    .returning()

                return updated
            })
        })
    }

    /**
     * Mark a traefikConfig as failed to sync
     */
    markTraefikConfigSyncFailed(configId: string, errorMessage: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [updated] = await db
                    .update(traefikConfigs)
                    .set({
                        syncStatus: 'failed',
                        syncErrorMessage: errorMessage,
                        updatedAt: new Date(),
                    })
                    .where(eq(traefikConfigs.id, configId))
                    .returning()

                return updated
            })
        })
    }

    createDomainRoute(input: CreateDomainRouteInput) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [route] = await db
                    .insert(traefikDomainRoutes)
                    .values({
                        ...input,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning()

                return route
            })
        })
    }

    getDomainRoutesByConfigId(configId: string, isActive?: boolean) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const conditions = [eq(traefikDomainRoutes.configId, configId)]

                if (isActive !== undefined) {
                    conditions.push(eq(traefikDomainRoutes.isActive, isActive))
                }

                return await db
                    .select()
                    .from(traefikDomainRoutes)
                    .where(and(...conditions))
                    .orderBy(desc(traefikDomainRoutes.priority))
            })
        })
    }

    updateDomainRoute(id: string, input: Partial<CreateDomainRouteInput>) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [updated] = await db
                    .update(traefikDomainRoutes)
                    .set({
                        ...input,
                        updatedAt: new Date(),
                    })
                    .where(eq(traefikDomainRoutes.id, id))
                    .returning()

                return updated
            })
        })
    }

    deleteDomainRoute(id: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [deleted] = await db
                    .delete(traefikDomainRoutes)
                    .where(eq(traefikDomainRoutes.id, id))
                    .returning()

                return deleted
            })
        })
    }

    createServiceTarget(input: CreateServiceTargetInput) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [target] = await db
                    .insert(traefikServiceTargets)
                    .values({
                        ...input,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning()

                return target
            })
        })
    }

    getServiceTargetsByConfigId(configId: string, isActive?: boolean) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const conditions = [
                    eq(traefikServiceTargets.configId, configId),
                ]

                if (isActive !== undefined) {
                    conditions.push(
                        eq(traefikServiceTargets.isActive, isActive)
                    )
                }

                return await db
                    .select()
                    .from(traefikServiceTargets)
                    .where(and(...conditions))
                    .orderBy(desc(traefikServiceTargets.weight))
            })
        })
    }

    updateServiceTarget(id: string, input: Partial<CreateServiceTargetInput>) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [updated] = await db
                    .update(traefikServiceTargets)
                    .set({
                        ...input,
                        updatedAt: new Date(),
                    })
                    .where(eq(traefikServiceTargets.id, id))
                    .returning()

                return updated
            })
        })
    }

    updateServiceTargetHealth(id: string, healthStatus: 'healthy' | 'unhealthy' | 'unknown') {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [updated] = await db
                    .update(traefikServiceTargets)
                    .set({
                        healthStatus,
                        lastHealthCheck: new Date(),
                        updatedAt: new Date(),
                    })
                    .where(eq(traefikServiceTargets.id, id))
                    .returning()

                return updated
            })
        })
    }

    deleteServiceTarget(id: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [deleted] = await db
                    .delete(traefikServiceTargets)
                    .where(eq(traefikServiceTargets.id, id))
                    .returning()

                return deleted
            })
        })
    }

    createSSLCertificate(input: CreateSSLCertificateInput) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [certificate] = await db
                    .insert(traefikSSLCertificates)
                    .values({
                        ...input,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning()

                return certificate
            })
        })
    }

    getSSLCertificatesByConfigId(configId: string, isActive?: boolean) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const conditions = [
                    eq(traefikSSLCertificates.configId, configId),
                ]

                if (isActive !== undefined) {
                    conditions.push(
                        eq(traefikSSLCertificates.isActive, isActive)
                    )
                }

                return await db
                    .select()
                    .from(traefikSSLCertificates)
                    .where(and(...conditions))
                    .orderBy(desc(traefikSSLCertificates.notAfter))
            })
        })
    }

    getExpiringCertificates(days = 30) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const expiryThreshold = new Date()
                expiryThreshold.setDate(expiryThreshold.getDate() + days)

                return await db
                    .select()
                    .from(traefikSSLCertificates)
                    .where(
                        and(
                            eq(traefikSSLCertificates.isActive, true),
                            eq(traefikSSLCertificates.autoRenew, true),
                            isNotNull(traefikSSLCertificates.notAfter)
                        )
                    )
                    .orderBy(asc(traefikSSLCertificates.notAfter))
            })
        })
    }

    updateSSLCertificate(id: string, input: Partial<CreateSSLCertificateInput>) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [updated] = await db
                    .update(traefikSSLCertificates)
                    .set({
                        ...input,
                        updatedAt: new Date(),
                    })
                    .where(eq(traefikSSLCertificates.id, id))
                    .returning()

                return updated
            })
        })
    }

    deleteSSLCertificate(id: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [deleted] = await db
                    .delete(traefikSSLCertificates)
                    .where(eq(traefikSSLCertificates.id, id))
                    .returning()

                return deleted
            })
        })
    }

    createConfigFile(input: CreateConfigFileInput) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [file] = await db
                    .insert(traefikConfigFiles)
                    .values({
                        ...input,
                        syncStatus: 'pending',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning()

                return file
            })
        })
    }

    getConfigFilesByConfigId(configId: string, isActive?: boolean) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const conditions = [eq(traefikConfigFiles.configId, configId)]

                if (isActive !== undefined) {
                    conditions.push(eq(traefikConfigFiles.isActive, isActive))
                }

                return await db
                    .select()
                    .from(traefikConfigFiles)
                    .where(and(...conditions))
                    .orderBy(desc(traefikConfigFiles.createdAt))
            })
        })
    }

    getConfigFilesByStatus(status: 'pending' | 'synced' | 'error') {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikConfigFiles)
                    .where(
                        and(
                            eq(traefikConfigFiles.syncStatus, status),
                            eq(traefikConfigFiles.isActive, true)
                        )
                    )
                    .orderBy(desc(traefikConfigFiles.createdAt))
            })
        })
    }

    updateConfigFile(id: string, input: Partial<
            CreateConfigFileInput & {
                syncStatus?: 'pending' | 'synced' | 'error'
                syncError?: string
                lastSynced?: Date
            }
        >) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [updated] = await db
                    .update(traefikConfigFiles)
                    .set({
                        ...input,
                        updatedAt: new Date(),
                    })
                    .where(eq(traefikConfigFiles.id, id))
                    .returning()

                return updated
            })
        })
    }

    updateConfigFileSyncStatus(id: string, syncStatus: 'pending' | 'synced' | 'error', syncError?: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [updated] = await db
                    .update(traefikConfigFiles)
                    .set({
                        syncStatus,
                        syncError,
                        lastSynced:
                            syncStatus === 'synced' ? new Date() : undefined,
                        updatedAt: new Date(),
                    })
                    .where(eq(traefikConfigFiles.id, id))
                    .returning()

                return updated
            })
        })
    }

    deleteConfigFile(id: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [deleted] = await db
                    .delete(traefikConfigFiles)
                    .where(eq(traefikConfigFiles.id, id))
                    .returning()

                return deleted
            })
        })
    }

    createMiddleware(input: CreateMiddlewareInput) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [middleware] = await db
                    .insert(traefikMiddlewares)
                    .values({
                        ...input,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning()

                return middleware
            })
        })
    }

    getMiddlewares(serviceId?: string, isGlobal?: boolean, isActive?: boolean) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const conditions: SQL[] = []

                if (serviceId !== undefined) {
                    conditions.push(eq(traefikMiddlewares.serviceId, serviceId))
                }

                if (isGlobal !== undefined) {
                    conditions.push(eq(traefikMiddlewares.isGlobal, isGlobal))
                }

                if (isActive !== undefined) {
                    conditions.push(eq(traefikMiddlewares.isActive, isActive))
                }

                if (conditions.length > 0) {
                    return await db
                        .select()
                        .from(traefikMiddlewares)
                        .where(and(...conditions))
                        .orderBy(desc(traefikMiddlewares.createdAt))
                } else {
                    return await db
                        .select()
                        .from(traefikMiddlewares)
                        .orderBy(desc(traefikMiddlewares.createdAt))
                }
            })
        })
    }

    getMiddleware(id: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [middleware] = await db
                    .select()
                    .from(traefikMiddlewares)
                    .where(eq(traefikMiddlewares.id, id))

                return middleware
            })
        })
    }

    updateMiddleware(id: string, input: Partial<CreateMiddlewareInput>) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [updated] = await db
                    .update(traefikMiddlewares)
                    .set({
                        ...input,
                        updatedAt: new Date(),
                    })
                    .where(eq(traefikMiddlewares.id, id))
                    .returning()

                return updated
            })
        })
    }

    deleteMiddleware(id: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [deleted] = await db
                    .delete(traefikMiddlewares)
                    .where(eq(traefikMiddlewares.id, id))
                    .returning()

                return deleted
            })
        })
    }

    getServiceConfigsNeedingSync() {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikServiceConfigs)
                    .where(
                        and(
                            eq(traefikServiceConfigs.isActive, true),
                            eq(traefikConfigFiles.syncStatus, 'pending')
                        )
                    )
                    .leftJoin(
                        traefikConfigFiles,
                        eq(
                            traefikServiceConfigs.id,
                            traefikConfigFiles.configId
                        )
                    )
                    .orderBy(desc(traefikServiceConfigs.updatedAt))
            })
        })
    }

    getServiceById(serviceId: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [service] = await db
                    .select()
                    .from(services)
                    .where(eq(services.id, serviceId))

                return service
            })
        })
    }

    getProjectById(projectId: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [project] = await db
                    .select()
                    .from(projects)
                    .where(eq(projects.id, projectId))

                return project
            })
        })
    }

    /**
     * Get all projects for file system structure
     */
    getAllProjects() {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select({
                        id: projects.id,
                        name: projects.name,
                        createdAt: projects.createdAt,
                        updatedAt: projects.updatedAt,
                    })
                    .from(projects)
                    .orderBy(asc(projects.name))
            })
        })
    }

    /**
     * Get all config files for file system structure
     */
    getAllConfigFiles(isActive?: boolean) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const conditions =
                    isActive !== undefined
                        ? [eq(traefikConfigFiles.isActive, isActive)]
                        : []

                return await db
                    .select({
                        id: traefikConfigFiles.id,
                        configId: traefikConfigFiles.configId,
                        fileName: traefikConfigFiles.fileName,
                        filePath: traefikConfigFiles.filePath,
                        relativePath: traefikConfigFiles.relativePath,
                        fileType: traefikConfigFiles.fileType,
                        contentType: traefikConfigFiles.contentType,
                        size: traefikConfigFiles.size,
                        checksum: traefikConfigFiles.checksum,
                        content: traefikConfigFiles.content,
                        syncStatus: traefikConfigFiles.syncStatus,
                        createdAt: traefikConfigFiles.createdAt,
                        updatedAt: traefikConfigFiles.updatedAt,
                    })
                    .from(traefikConfigFiles)
                    .where(
                        conditions.length > 0 ? and(...conditions) : undefined
                    )
                    .orderBy(asc(traefikConfigFiles.relativePath))
            })
        })
    }

    /**
     * Get config files by project for file system structure
     */
    getConfigFilesByProject(projectId: string, isActive?: boolean) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const conditions = [eq(services.projectId, projectId)]

                if (isActive !== undefined) {
                    conditions.push(eq(traefikConfigFiles.isActive, isActive))
                }

                return await db
                    .select({
                        id: traefikConfigFiles.id,
                        configId: traefikConfigFiles.configId,
                        fileName: traefikConfigFiles.fileName,
                        filePath: traefikConfigFiles.filePath,
                        relativePath: traefikConfigFiles.relativePath,
                        fileType: traefikConfigFiles.fileType,
                        contentType: traefikConfigFiles.contentType,
                        size: traefikConfigFiles.size,
                        checksum: traefikConfigFiles.checksum,
                        content: traefikConfigFiles.content,
                        syncStatus: traefikConfigFiles.syncStatus,
                        createdAt: traefikConfigFiles.createdAt,
                        updatedAt: traefikConfigFiles.updatedAt,
                        serviceName: services.name,
                        projectName: projects.name,
                    })
                    .from(traefikConfigFiles)
                    .innerJoin(
                        traefikServiceConfigs,
                        eq(
                            traefikConfigFiles.configId,
                            traefikServiceConfigs.id
                        )
                    )
                    .innerJoin(
                        services,
                        eq(traefikServiceConfigs.serviceId, services.id)
                    )
                    .innerJoin(projects, eq(services.projectId, projects.id))
                    .where(and(...conditions))
                    .orderBy(asc(traefikConfigFiles.relativePath))
            })
        })
    }

    /**
     * Get config file by path for content retrieval
     */
    getConfigFileByPath(relativePath: string, isActive?: boolean) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const conditions = [
                    eq(traefikConfigFiles.relativePath, relativePath),
                ]

                if (isActive !== undefined) {
                    conditions.push(eq(traefikConfigFiles.isActive, isActive))
                }

                const [configFile] = await db
                    .select()
                    .from(traefikConfigFiles)
                    .where(and(...conditions))

                return configFile
            })
        })
    }

    createNewSslCertificate(data: Omit<CreateTraefikSslCertificate, 'id'>) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [certificate] = await db
                    .insert(traefikSSLCertificates)
                    .values(data)
                    .returning()
                return certificate
            })
        })
    }

    getNewSslCertificatesByProject(projectId: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                // Get SSL certificates by joining with service configs and services to find those belonging to a project
                return await db
                    .select()
                    .from(traefikSSLCertificates)
                    .innerJoin(
                        traefikServiceConfigs,
                        eq(
                            traefikSSLCertificates.configId,
                            traefikServiceConfigs.id
                        )
                    )
                    .innerJoin(
                        services,
                        eq(traefikServiceConfigs.serviceId, services.id)
                    )
                    .where(eq(services.projectId, projectId))
                    .orderBy(asc(traefikSSLCertificates.domain))
            })
        })
    }

    getAllNewSslCertificates() {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikSSLCertificates)
                    .orderBy(asc(traefikSSLCertificates.domain))
            })
        })
    }

    createNewMiddleware(data: Omit<CreateTraefikMiddleware, 'id'>) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [middleware] = await db
                    .insert(traefikMiddleware)
                    .values(data)
                    .returning()
                return middleware
            })
        })
    }

    getNewMiddlewareByProject(projectId: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikMiddleware)
                    .where(eq(traefikMiddleware.projectId, projectId))
                    .orderBy(asc(traefikMiddleware.middlewareName))
            })
        })
    }

    getGlobalNewMiddleware() {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikMiddleware)
                    .where(eq(traefikMiddleware.isGlobal, true))
                    .orderBy(asc(traefikMiddleware.middlewareName))
            })
        })
    }

    getAllNewMiddleware() {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikMiddleware)
                    .orderBy(asc(traefikMiddleware.middlewareName))
            })
        })
    }

    createPlugin(data: Omit<CreateTraefikPlugin, 'id'>) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [plugin] = await db
                    .insert(traefikPlugins)
                    .values(data)
                    .returning()
                return plugin
            })
        })
    }

    getPluginsByProject(projectId: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikPlugins)
                    .where(eq(traefikPlugins.projectId, projectId))
                    .orderBy(asc(traefikPlugins.pluginName))
            })
        })
    }

    getAllPlugins() {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikPlugins)
                    .orderBy(asc(traefikPlugins.pluginName))
            })
        })
    }

    createStaticFile(data: Omit<CreateTraefikStaticFile, 'id'>) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [staticFile] = await db
                    .insert(traefikStaticFiles)
                    .values(data)
                    .returning()
                return staticFile
            })
        })
    }

    getStaticFilesByProject(projectId: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikStaticFiles)
                    .where(eq(traefikStaticFiles.projectId, projectId))
                    .orderBy(asc(traefikStaticFiles.relativePath))
            })
        })
    }

    getAllStaticFiles() {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikStaticFiles)
                    .orderBy(asc(traefikStaticFiles.relativePath))
            })
        })
    }

    deleteStaticFile(id: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                await db
                    .delete(traefikStaticFiles)
                    .where(eq(traefikStaticFiles.id, id))
            })
        })
    }

    getStaticFileByPath(projectId: string, relativePath: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [staticFile] = await db
                    .select()
                    .from(traefikStaticFiles)
                    .where(
                        and(
                            eq(traefikStaticFiles.projectId, projectId),
                            eq(traefikStaticFiles.relativePath, relativePath)
                        )
                    )
                return staticFile
            })
        })
    }

    createBackup(data: Omit<CreateTraefikBackup, 'id'>) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [backup] = await db
                    .insert(traefikBackups)
                    .values(data)
                    .returning()
                return backup
            })
        })
    }

    getBackupsByProject(projectId: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikBackups)
                    .where(eq(traefikBackups.projectId, projectId))
                    .orderBy(desc(traefikBackups.createdAt))
            })
        })
    }

    getAllBackups() {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikBackups)
                    .orderBy(desc(traefikBackups.createdAt))
            })
        })
    }

    getTraefikConfigsByProject(projectId: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikConfigs)
                    .where(eq(traefikConfigs.projectId, projectId))
                    .orderBy(asc(traefikConfigs.configName))
            })
        })
    }

    getTraefikConfigById(configId: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [result] = await db
                    .select()
                    .from(traefikConfigs)
                    .where(eq(traefikConfigs.id, configId))
                    .limit(1)

                return result ?? null
            })
        })
    }

    getAllTraefikConfigs() {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                return await db
                    .select()
                    .from(traefikConfigs)
                    .orderBy(asc(traefikConfigs.configName))
            })
        })
    }

    /**
     * Get all Traefik configs that need syncing
     * (configs where updatedAt > lastSyncedAt OR lastSyncedAt IS NULL)
     */
    getTraefikConfigsNeedingSync(isActive = true) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const baseConditions = [
                    eq(traefikConfigs.requiresFile, true), // Only sync configs that require files
                    // Either never synced OR updated since last sync
                    or(
                        isNull(traefikConfigs.lastSyncedAt),
                        gt(
                            traefikConfigs.updatedAt,
                            traefikConfigs.lastSyncedAt
                        )
                    ),
                ]

                if (isActive) {
                    baseConditions.push(eq(traefikConfigs.isActive, true))
                }

                return await db
                    .select({
                        id: traefikConfigs.id,
                        configName: traefikConfigs.configName,
                        configContent: traefikConfigs.configContent,
                        configType: traefikConfigs.configType,
                        storageType: traefikConfigs.storageType,
                        projectId: traefikConfigs.projectId,
                        requiresFile: traefikConfigs.requiresFile,
                        syncStatus: traefikConfigs.syncStatus,
                        lastSyncedAt: traefikConfigs.lastSyncedAt,
                        syncErrorMessage: traefikConfigs.syncErrorMessage,
                        fileChecksum: traefikConfigs.fileChecksum,
                        configVersion: traefikConfigs.configVersion,
                        metadata: traefikConfigs.metadata,
                        description: traefikConfigs.description,
                        tags: traefikConfigs.tags,
                        isActive: traefikConfigs.isActive,
                        createdAt: traefikConfigs.createdAt,
                        updatedAt: traefikConfigs.updatedAt,
                        projectName: projects.name, // Include project name for path generation
                    })
                    .from(traefikConfigs)
                    .leftJoin(
                        projects,
                        eq(traefikConfigs.projectId, projects.id)
                    ) // Left join for standalone configs
                    .where(and(...baseConditions))
                    .orderBy(desc(traefikConfigs.updatedAt))
            })
        })
    }

    /**
     * Get Traefik configs that need syncing for a specific project
     */
    getTraefikConfigsNeedingSyncByProject(projectId: string, isActive = true) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const baseConditions = [
                    eq(traefikConfigs.projectId, projectId),
                    eq(traefikConfigs.requiresFile, true), // Only sync configs that require files
                    // Either never synced OR updated since last sync
                    or(
                        isNull(traefikConfigs.lastSyncedAt),
                        gt(
                            traefikConfigs.updatedAt,
                            traefikConfigs.lastSyncedAt
                        )
                    ),
                ]

                if (isActive) {
                    baseConditions.push(eq(traefikConfigs.isActive, true))
                }

                return await db
                    .select({
                        id: traefikConfigs.id,
                        configName: traefikConfigs.configName,
                        configContent: traefikConfigs.configContent,
                        configType: traefikConfigs.configType,
                        storageType: traefikConfigs.storageType,
                        projectId: traefikConfigs.projectId,
                        requiresFile: traefikConfigs.requiresFile,
                        syncStatus: traefikConfigs.syncStatus,
                        lastSyncedAt: traefikConfigs.lastSyncedAt,
                        syncErrorMessage: traefikConfigs.syncErrorMessage,
                        fileChecksum: traefikConfigs.fileChecksum,
                        configVersion: traefikConfigs.configVersion,
                        metadata: traefikConfigs.metadata,
                        description: traefikConfigs.description,
                        tags: traefikConfigs.tags,
                        isActive: traefikConfigs.isActive,
                        createdAt: traefikConfigs.createdAt,
                        updatedAt: traefikConfigs.updatedAt,
                        projectName: projects.name, // Include project name for path generation
                    })
                    .from(traefikConfigs)
                    .leftJoin(
                        projects,
                        eq(traefikConfigs.projectId, projects.id)
                    ) // Left join for project name
                    .where(and(...baseConditions))
                    .orderBy(desc(traefikConfigs.updatedAt))
            })
        })
    }

    /**
     * Get standalone Traefik configs that need syncing
     */
    getStandaloneTraefikConfigsNeedingSync(isActive = true) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const baseConditions = [
                    eq(traefikConfigs.storageType, 'standalone'),
                    eq(traefikConfigs.requiresFile, true), // Only sync configs that require files
                    // Either never synced OR updated since last sync
                    or(
                        isNull(traefikConfigs.lastSyncedAt),
                        gt(
                            traefikConfigs.updatedAt,
                            traefikConfigs.lastSyncedAt
                        )
                    ),
                ]

                if (isActive) {
                    baseConditions.push(eq(traefikConfigs.isActive, true))
                }

                return await db
                    .select({
                        id: traefikConfigs.id,
                        configName: traefikConfigs.configName,
                        configContent: traefikConfigs.configContent,
                        configType: traefikConfigs.configType,
                        storageType: traefikConfigs.storageType,
                        projectId: traefikConfigs.projectId,
                        requiresFile: traefikConfigs.requiresFile,
                        syncStatus: traefikConfigs.syncStatus,
                        lastSyncedAt: traefikConfigs.lastSyncedAt,
                        syncErrorMessage: traefikConfigs.syncErrorMessage,
                        fileChecksum: traefikConfigs.fileChecksum,
                        configVersion: traefikConfigs.configVersion,
                        metadata: traefikConfigs.metadata,
                        description: traefikConfigs.description,
                        tags: traefikConfigs.tags,
                        isActive: traefikConfigs.isActive,
                        createdAt: traefikConfigs.createdAt,
                        updatedAt: traefikConfigs.updatedAt,
                        projectName: projects.name, // Should be null for standalone configs
                    })
                    .from(traefikConfigs)
                    .leftJoin(
                        projects,
                        eq(traefikConfigs.projectId, projects.id)
                    ) // Left join (null for standalone)
                    .where(and(...baseConditions))
                    .orderBy(desc(traefikConfigs.updatedAt))
            })
        })
    }

    getStaticConfigByProject(projectId: string) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, async (db) => {
                const [config] = await db
                    .select()
                    .from(traefikStaticConfigs)
                    .where(eq(traefikStaticConfigs.projectId, projectId))
                return config
            })
        })
    }

    updateServiceConfig(input: UpdateServiceConfigInput) {
        return Effect.gen({ self: this }, function* () {
            const database = yield* DatabasePort
            const updateData: Partial<UpdateServiceConfigInput> = {
                ...input,
            }
            delete updateData.id

            if (input.subdomain !== undefined || input.domain !== undefined) {
                const existingConfig = yield* this.getServiceConfig(input.id)
                if (existingConfig) {
                    const domain = input.domain ?? existingConfig.domain
                    const subdomain = input.subdomain ?? existingConfig.subdomain
                    updateData.fullDomain = subdomain
                        ? `${subdomain}.${domain}`
                        : domain
                }
            }

            updateData.updatedAt = new Date()

            const [updated] = yield* storage(database, (db) =>
                db
                    .update(traefikServiceConfigs)
                    .set(updateData)
                    .where(eq(traefikServiceConfigs.id, input.id))
                    .returning()
            )

            return updated ?? null
        })
    }

    getCompleteServiceConfig(configId: string) {
        return Effect.gen({ self: this }, function* () {
            const config = yield* this.getServiceConfig(configId)
            if (!config) return null

            const [
                domainRoutes,
                serviceTargets,
                sslCertificates,
                configFiles,
                middlewares,
            ] = yield* Effect.all(
                [
                    this.getDomainRoutesByConfigId(config.id, true),
                    this.getServiceTargetsByConfigId(config.id, true),
                    this.getSSLCertificatesByConfigId(config.id, true),
                    this.getConfigFilesByConfigId(config.id, true),
                    this.getMiddlewares(config.serviceId, false, true),
                ],
                { concurrency: 'unbounded' }
            )

            return {
                ...config,
                domainRoutes,
                serviceTargets,
                sslCertificates,
                configFiles,
                middlewares,
            }
        })
    }

    getHealthCheckSummary() {
        return Effect.gen({ self: this }, function* () {
            const configs = yield* this.getAllServiceConfigs(true)
            return yield* Effect.forEach(
                configs,
                (config) =>
                    this.getServiceTargetsByConfigId(config.id, true).pipe(
                        Effect.map((targets) => ({
                            configId: config.id,
                            serviceId: config.serviceId,
                            domain: config.fullDomain,
                            totalTargets: targets.length,
                            healthyTargets: targets.filter(
                                (t) => t.healthStatus === 'healthy'
                            ).length,
                            unhealthyTargets: targets.filter(
                                (t) => t.healthStatus === 'unhealthy'
                            ).length,
                            unknownTargets: targets.filter(
                                (t) => t.healthStatus === 'unknown'
                            ).length,
                        }))
                    ),
                { concurrency: 'unbounded' }
            )
        })
    }
}

export type TraefikRepositoryShape = TraefikRepositoryImpl

export class TraefikRepository extends Context.Service<
    TraefikRepository,
    TraefikRepositoryShape
>()('shared/TraefikRepository') {
    static readonly live = TraefikRepositoryImpl
}
