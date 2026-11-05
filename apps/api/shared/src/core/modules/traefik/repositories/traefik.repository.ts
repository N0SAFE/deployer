import { Context, Effect } from "effect";
import { eq, and, desc, asc, isNotNull, inArray, or, isNull, gt, SQL } from "drizzle-orm";

import { services, projects } from "@deployer/nest-schema/global/project/deployment";
import { traefikServiceConfigs, traefikDomainRoutes, traefikServiceTargets, traefikConfigFiles, traefikMiddlewares, traefikSSLCertificates, traefikMiddleware, traefikPlugins, traefikStaticFiles, traefikBackups, traefikStaticConfigs, traefikConfigs, type CreateTraefikSslCertificate, type CreateTraefikMiddleware, type CreateTraefikPlugin, type CreateTraefikStaticFile, type CreateTraefikBackup } from "@deployer/nest-schema/global/traefik/index";

import { DatabasePort, storage } from "../../database/storage";

export type CreateServiceConfigInput = {
    serviceId: string;
    domain: string;
    subdomain?: string;
    port: number;
    sslEnabled?: boolean;
    sslProvider?: "letsencrypt" | "selfsigned" | "custom";
    pathPrefix?: string;
    middleware?: any;
    healthCheck?: {
        enabled: boolean;
        path: string;
        interval?: number;
        timeout?: number;
    };
    isActive?: boolean;
}

export type UpdateServiceConfigInput = {
    id: string;
    fullDomain?: string;
    updatedAt?: Date;
} & Partial<CreateServiceConfigInput>

export type CreateDomainRouteInput = {
    configId: string;
    hostRule: string;
    pathRule?: string;
    method?: string;
    headers?: any;
    priority?: number;
    entryPoint?: string;
    middleware?: any;
    isActive?: boolean;
}

export type CreateServiceTargetInput = {
    configId: string;
    url: string;
    weight?: number;
    healthCheck?: {
        enabled: boolean;
        path: string;
        interval?: number;
        timeout?: number;
        retries?: number;
    };
    isActive?: boolean;
}

export type CreateSSLCertificateInput = {
    configId: string;
    domain: string;
    subjectAltNames?: string[];
    issuer?: string;
    serialNumber?: string;
    fingerprint?: string;
    notBefore?: Date;
    notAfter?: Date;
    certificateData?: string;
    privateKeyData?: string;
    autoRenew?: boolean;
    renewalThreshold?: number;
    isActive?: boolean;
}

export type CreateConfigFileInput = {
    configId: string;
    fileName: string;
    filePath: string;
    relativePath: string;
    fileType?: "traefik" | "ssl" | "middleware" | "config";
    contentType?: string;
    size?: number;
    checksum?: string;
    content?: string;
    isActive?: boolean;
}

export type CreateMiddlewareInput = {
    name: string;
    type: "auth" | "compression" | "headers" | "ratelimit" | "redirect" | "custom";
    config: any;
    description?: string;
    isGlobal?: boolean;
    serviceId?: string;
    isActive?: boolean;
}


type Ports = { readonly database: Context.Service.Shape<typeof DatabasePort> };

/** The Traefik tables' data access. Every method is one query (or a few) and fails with `StorageFailure`. */
export function makeTraefikRepository({ database }: Ports) {
    const leaf = {
        getProjectIdByName: (projectName: string) =>
            storage(database, async (db) => {
            const [result] = await db.select({ id: projects.id }).from(projects).where(eq(projects.name, projectName)).limit(1);

            return result?.id ?? null;
            }),

        createServiceConfig: (input: CreateServiceConfigInput) =>
            storage(database, async (db) => {
            const fullDomain = input.subdomain ? `${input.subdomain}.${input.domain}` : input.domain;

            const [config] = await db
                .insert(traefikServiceConfigs)
                .values({
                    ...input,
                    fullDomain,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
                .returning();

            return config ?? null;
            }),

        getServiceConfig: (id: string) =>
            storage(database, async (db) => {
            const [config] = await db.select().from(traefikServiceConfigs).where(eq(traefikServiceConfigs.id, id));

            return config;
            }),

        getServiceConfigByServiceId: (serviceId: string) =>
            storage(database, async (db) => {
            const [config] = await db.select().from(traefikServiceConfigs).where(eq(traefikServiceConfigs.serviceId, serviceId));

            return config;
            }),

        getAllServiceConfigs: (isActive?: boolean) =>
            storage(database, async (db) => {
            const query = db.select().from(traefikServiceConfigs).orderBy(desc(traefikServiceConfigs.createdAt));

            if (isActive !== undefined) {
                query.where(eq(traefikServiceConfigs.isActive, isActive));
            }

            return await query;
            }),

        getServiceConfigsByDomain: (domain: string, isActive?: boolean) =>
            storage(database, async (db) => {
            const conditions = [eq(traefikServiceConfigs.domain, domain)];

            if (isActive !== undefined) {
                conditions.push(eq(traefikServiceConfigs.isActive, isActive));
            }

            return await db
                .select()
                .from(traefikServiceConfigs)
                .where(and(...conditions))
                .orderBy(desc(traefikServiceConfigs.createdAt));
            }),

        getServiceConfigsByProject: (projectId: string, isActive?: boolean) =>
            storage(database, async (db) => {
            // Get all services for the project first
            const projectServices = await db.select({ id: services.id }).from(services).where(eq(services.projectId, projectId));

            const serviceIds = projectServices.map((service) => service.id);

            if (serviceIds.length === 0) {
                return [];
            }

            // Get all Traefik configurations for these services
            const conditions = [inArray(traefikServiceConfigs.serviceId, serviceIds)];

            if (isActive !== undefined) {
                conditions.push(eq(traefikServiceConfigs.isActive, isActive));
            }

            return await db
                .select()
                .from(traefikServiceConfigs)
                .where(and(...conditions))
                .orderBy(desc(traefikServiceConfigs.createdAt));
            }),

        deleteServiceConfig: (id: string) =>
            storage(database, async (db) => {
            // First delete dependent records to avoid foreign key constraints

            // Delete config files that reference this service config
            await db.delete(traefikConfigFiles).where(eq(traefikConfigFiles.configId, id));

            // Delete domain routes that reference this service config
            await db.delete(traefikDomainRoutes).where(eq(traefikDomainRoutes.configId, id));

            // Delete service targets that reference this service config
            await db.delete(traefikServiceTargets).where(eq(traefikServiceTargets.configId, id));

            // Now delete the service config itself
            const [deletedConfig] = await db.delete(traefikServiceConfigs).where(eq(traefikServiceConfigs.id, id)).returning();

            return deletedConfig;
            }),

        updateConfigSyncStatus: (configId: string, lastSyncedAt: Date) =>
            storage(database, async (db) => {
            const [updated] = await db
                .update(traefikServiceConfigs)
                .set({
                    lastSyncedAt,
                    updatedAt: new Date(),
                })
                .where(eq(traefikServiceConfigs.id, configId))
                .returning();

            return updated;
            }),

      /**
       * Update sync status for traefikConfigs table (virtual filesystem)
       */
        updateTraefikConfigSyncStatus: (configId: string, lastSyncedAt: Date) =>
            storage(database, async (db) => {
            const [updated] = await db
                .update(traefikConfigs)
                .set({
                    lastSyncedAt,
                    syncStatus: "synced",
                    syncErrorMessage: null,
                    updatedAt: new Date(),
                })
                .where(eq(traefikConfigs.id, configId))
                .returning();

            return updated;
            }),

      /**
       * Mark a traefikConfig as failed to sync
       */
        markTraefikConfigSyncFailed: (configId: string, errorMessage: string) =>
            storage(database, async (db) => {
            const [updated] = await db
                .update(traefikConfigs)
                .set({
                    syncStatus: "failed",
                    syncErrorMessage: errorMessage,
                    updatedAt: new Date(),
                })
                .where(eq(traefikConfigs.id, configId))
                .returning();

            return updated;
            }),

        createDomainRoute: (input: CreateDomainRouteInput) =>
            storage(database, async (db) => {
            const [route] = await db
                .insert(traefikDomainRoutes)
                .values({
                    ...input,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
                .returning();

            return route;
            }),

        getDomainRoutesByConfigId: (configId: string, isActive?: boolean) =>
            storage(database, async (db) => {
            const conditions = [eq(traefikDomainRoutes.configId, configId)];

            if (isActive !== undefined) {
                conditions.push(eq(traefikDomainRoutes.isActive, isActive));
            }

            return await db
                .select()
                .from(traefikDomainRoutes)
                .where(and(...conditions))
                .orderBy(desc(traefikDomainRoutes.priority));
            }),

        updateDomainRoute: (id: string, input: Partial<CreateDomainRouteInput>) =>
            storage(database, async (db) => {
            const [updated] = await db
                .update(traefikDomainRoutes)
                .set({
                    ...input,
                    updatedAt: new Date(),
                })
                .where(eq(traefikDomainRoutes.id, id))
                .returning();

            return updated;
            }),

        deleteDomainRoute: (id: string) =>
            storage(database, async (db) => {
            const [deleted] = await db.delete(traefikDomainRoutes).where(eq(traefikDomainRoutes.id, id)).returning();

            return deleted;
            }),

        createServiceTarget: (input: CreateServiceTargetInput) =>
            storage(database, async (db) => {
            const [target] = await db
                .insert(traefikServiceTargets)
                .values({
                    ...input,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
                .returning();

            return target;
            }),

        getServiceTargetsByConfigId: (configId: string, isActive?: boolean) =>
            storage(database, async (db) => {
            const conditions = [eq(traefikServiceTargets.configId, configId)];

            if (isActive !== undefined) {
                conditions.push(eq(traefikServiceTargets.isActive, isActive));
            }

            return await db
                .select()
                .from(traefikServiceTargets)
                .where(and(...conditions))
                .orderBy(desc(traefikServiceTargets.weight));
            }),

        updateServiceTarget: (id: string, input: Partial<CreateServiceTargetInput>) =>
            storage(database, async (db) => {
            const [updated] = await db
                .update(traefikServiceTargets)
                .set({
                    ...input,
                    updatedAt: new Date(),
                })
                .where(eq(traefikServiceTargets.id, id))
                .returning();

            return updated;
            }),

        updateServiceTargetHealth: (id: string, healthStatus: "healthy" | "unhealthy" | "unknown") =>
            storage(database, async (db) => {
            const [updated] = await db
                .update(traefikServiceTargets)
                .set({
                    healthStatus,
                    lastHealthCheck: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(traefikServiceTargets.id, id))
                .returning();

            return updated;
            }),

        deleteServiceTarget: (id: string) =>
            storage(database, async (db) => {
            const [deleted] = await db.delete(traefikServiceTargets).where(eq(traefikServiceTargets.id, id)).returning();

            return deleted;
            }),

        createSSLCertificate: (input: CreateSSLCertificateInput) =>
            storage(database, async (db) => {
            const [certificate] = await db
                .insert(traefikSSLCertificates)
                .values({
                    ...input,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
                .returning();

            return certificate;
            }),

        getSSLCertificatesByConfigId: (configId: string, isActive?: boolean) =>
            storage(database, async (db) => {
            const conditions = [eq(traefikSSLCertificates.configId, configId)];

            if (isActive !== undefined) {
                conditions.push(eq(traefikSSLCertificates.isActive, isActive));
            }

            return await db
                .select()
                .from(traefikSSLCertificates)
                .where(and(...conditions))
                .orderBy(desc(traefikSSLCertificates.notAfter));
            }),

        getExpiringCertificates: (days = 30) =>
            storage(database, async (db) => {
            const expiryThreshold = new Date();
            expiryThreshold.setDate(expiryThreshold.getDate() + days);

            return await db
                .select()
                .from(traefikSSLCertificates)
                .where(and(eq(traefikSSLCertificates.isActive, true), eq(traefikSSLCertificates.autoRenew, true), isNotNull(traefikSSLCertificates.notAfter)))
                .orderBy(asc(traefikSSLCertificates.notAfter));
            }),

        updateSSLCertificate: (id: string, input: Partial<CreateSSLCertificateInput>) =>
            storage(database, async (db) => {
            const [updated] = await db
                .update(traefikSSLCertificates)
                .set({
                    ...input,
                    updatedAt: new Date(),
                })
                .where(eq(traefikSSLCertificates.id, id))
                .returning();

            return updated;
            }),

        deleteSSLCertificate: (id: string) =>
            storage(database, async (db) => {
            const [deleted] = await db.delete(traefikSSLCertificates).where(eq(traefikSSLCertificates.id, id)).returning();

            return deleted;
            }),

        createConfigFile: (input: CreateConfigFileInput) =>
            storage(database, async (db) => {
            const [file] = await db
                .insert(traefikConfigFiles)
                .values({
                    ...input,
                    syncStatus: "pending",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
                .returning();

            return file;
            }),

        getConfigFilesByConfigId: (configId: string, isActive?: boolean) =>
            storage(database, async (db) => {
            const conditions = [eq(traefikConfigFiles.configId, configId)];

            if (isActive !== undefined) {
                conditions.push(eq(traefikConfigFiles.isActive, isActive));
            }

            return await db
                .select()
                .from(traefikConfigFiles)
                .where(and(...conditions))
                .orderBy(desc(traefikConfigFiles.createdAt));
            }),

        getConfigFilesByStatus: (status: "pending" | "synced" | "error") =>
            storage(database, async (db) => {
            return await db
                .select()
                .from(traefikConfigFiles)
                .where(and(eq(traefikConfigFiles.syncStatus, status), eq(traefikConfigFiles.isActive, true)))
                .orderBy(desc(traefikConfigFiles.createdAt));
            }),

        updateConfigFile: (
        id: string,
        input: Partial<
            CreateConfigFileInput & {
                syncStatus?: "pending" | "synced" | "error";
                syncError?: string;
                lastSynced?: Date;
            }
        >,
    ) =>
            storage(database, async (db) => {
            const [updated] = await db
                .update(traefikConfigFiles)
                .set({
                    ...input,
                    updatedAt: new Date(),
                })
                .where(eq(traefikConfigFiles.id, id))
                .returning();

            return updated;
            }),

        updateConfigFileSyncStatus: (id: string, syncStatus: "pending" | "synced" | "error", syncError?: string) =>
            storage(database, async (db) => {
            const [updated] = await db
                .update(traefikConfigFiles)
                .set({
                    syncStatus,
                    syncError,
                    lastSynced: syncStatus === "synced" ? new Date() : undefined,
                    updatedAt: new Date(),
                })
                .where(eq(traefikConfigFiles.id, id))
                .returning();

            return updated;
            }),

        deleteConfigFile: (id: string) =>
            storage(database, async (db) => {
            const [deleted] = await db.delete(traefikConfigFiles).where(eq(traefikConfigFiles.id, id)).returning();

            return deleted;
            }),

        createMiddleware: (input: CreateMiddlewareInput) =>
            storage(database, async (db) => {
            const [middleware] = await db
                .insert(traefikMiddlewares)
                .values({
                    ...input,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
                .returning();

            return middleware;
            }),

        getMiddlewares: (serviceId?: string, isGlobal?: boolean, isActive?: boolean) =>
            storage(database, async (db) => {
            const conditions: SQL[] = [];

            if (serviceId !== undefined) {
                conditions.push(eq(traefikMiddlewares.serviceId, serviceId));
            }

            if (isGlobal !== undefined) {
                conditions.push(eq(traefikMiddlewares.isGlobal, isGlobal));
            }

            if (isActive !== undefined) {
                conditions.push(eq(traefikMiddlewares.isActive, isActive));
            }

            if (conditions.length > 0) {
                return await db
                    .select()
                    .from(traefikMiddlewares)
                    .where(and(...conditions))
                    .orderBy(desc(traefikMiddlewares.createdAt));
            } else {
                return await db.select().from(traefikMiddlewares).orderBy(desc(traefikMiddlewares.createdAt));
            }
            }),

        getMiddleware: (id: string) =>
            storage(database, async (db) => {
            const [middleware] = await db.select().from(traefikMiddlewares).where(eq(traefikMiddlewares.id, id));

            return middleware;
            }),

        updateMiddleware: (id: string, input: Partial<CreateMiddlewareInput>) =>
            storage(database, async (db) => {
            const [updated] = await db
                .update(traefikMiddlewares)
                .set({
                    ...input,
                    updatedAt: new Date(),
                })
                .where(eq(traefikMiddlewares.id, id))
                .returning();

            return updated;
            }),

        deleteMiddleware: (id: string) =>
            storage(database, async (db) => {
            const [deleted] = await db.delete(traefikMiddlewares).where(eq(traefikMiddlewares.id, id)).returning();

            return deleted;
            }),

        getServiceConfigsNeedingSync: () =>
            storage(database, async (db) => {
            return await db
                .select()
                .from(traefikServiceConfigs)
                .where(and(eq(traefikServiceConfigs.isActive, true), eq(traefikConfigFiles.syncStatus, "pending")))
                .leftJoin(traefikConfigFiles, eq(traefikServiceConfigs.id, traefikConfigFiles.configId))
                .orderBy(desc(traefikServiceConfigs.updatedAt));
            }),

        getServiceById: (serviceId: string) =>
            storage(database, async (db) => {
            const [service] = await db.select().from(services).where(eq(services.id, serviceId));

            return service;
            }),

        getProjectById: (projectId: string) =>
            storage(database, async (db) => {
            const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

            return project;
            }),

      /**
       * Get all projects for file system structure
       */
        getAllProjects: () =>
            storage(database, async (db) => {
            return await db
                .select({
                    id: projects.id,
                    name: projects.name,
                    createdAt: projects.createdAt,
                    updatedAt: projects.updatedAt,
                })
                .from(projects)
                .orderBy(asc(projects.name));
            }),

      /**
       * Get all config files for file system structure
       */
        getAllConfigFiles: (isActive?: boolean) =>
            storage(database, async (db) => {
            const conditions = isActive !== undefined ? [eq(traefikConfigFiles.isActive, isActive)] : [];

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
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .orderBy(asc(traefikConfigFiles.relativePath));
            }),

      /**
       * Get config files by project for file system structure
       */
        getConfigFilesByProject: (projectId: string, isActive?: boolean) =>
            storage(database, async (db) => {
            const conditions = [eq(services.projectId, projectId)];

            if (isActive !== undefined) {
                conditions.push(eq(traefikConfigFiles.isActive, isActive));
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
                .innerJoin(traefikServiceConfigs, eq(traefikConfigFiles.configId, traefikServiceConfigs.id))
                .innerJoin(services, eq(traefikServiceConfigs.serviceId, services.id))
                .innerJoin(projects, eq(services.projectId, projects.id))
                .where(and(...conditions))
                .orderBy(asc(traefikConfigFiles.relativePath));
            }),

      /**
       * Get config file by path for content retrieval
       */
        getConfigFileByPath: (relativePath: string, isActive?: boolean) =>
            storage(database, async (db) => {
            const conditions = [eq(traefikConfigFiles.relativePath, relativePath)];

            if (isActive !== undefined) {
                conditions.push(eq(traefikConfigFiles.isActive, isActive));
            }

            const [configFile] = await db
                .select()
                .from(traefikConfigFiles)
                .where(and(...conditions));

            return configFile;
            }),

        createNewSslCertificate: (data: Omit<CreateTraefikSslCertificate, "id">) =>
            storage(database, async (db) => {
            const [certificate] = await db.insert(traefikSSLCertificates).values(data).returning();
            return certificate;
            }),

        getNewSslCertificatesByProject: (projectId: string) =>
            storage(database, async (db) => {
            // Get SSL certificates by joining with service configs and services to find those belonging to a project
            return await db
                .select()
                .from(traefikSSLCertificates)
                .innerJoin(traefikServiceConfigs, eq(traefikSSLCertificates.configId, traefikServiceConfigs.id))
                .innerJoin(services, eq(traefikServiceConfigs.serviceId, services.id))
                .where(eq(services.projectId, projectId))
                .orderBy(asc(traefikSSLCertificates.domain));
            }),

        getAllNewSslCertificates: () =>
            storage(database, async (db) => {
            return await db.select().from(traefikSSLCertificates).orderBy(asc(traefikSSLCertificates.domain));
            }),

        createNewMiddleware: (data: Omit<CreateTraefikMiddleware, "id">) =>
            storage(database, async (db) => {
            const [middleware] = await db.insert(traefikMiddleware).values(data).returning();
            return middleware;
            }),

        getNewMiddlewareByProject: (projectId: string) =>
            storage(database, async (db) => {
            return await db.select().from(traefikMiddleware).where(eq(traefikMiddleware.projectId, projectId)).orderBy(asc(traefikMiddleware.middlewareName));
            }),

        getGlobalNewMiddleware: () =>
            storage(database, async (db) => {
            return await db.select().from(traefikMiddleware).where(eq(traefikMiddleware.isGlobal, true)).orderBy(asc(traefikMiddleware.middlewareName));
            }),

        getAllNewMiddleware: () =>
            storage(database, async (db) => {
            return await db.select().from(traefikMiddleware).orderBy(asc(traefikMiddleware.middlewareName));
            }),

        createPlugin: (data: Omit<CreateTraefikPlugin, "id">) =>
            storage(database, async (db) => {
            const [plugin] = await db.insert(traefikPlugins).values(data).returning();
            return plugin;
            }),

        getPluginsByProject: (projectId: string) =>
            storage(database, async (db) => {
            return await db.select().from(traefikPlugins).where(eq(traefikPlugins.projectId, projectId)).orderBy(asc(traefikPlugins.pluginName));
            }),

        getAllPlugins: () =>
            storage(database, async (db) => {
            return await db.select().from(traefikPlugins).orderBy(asc(traefikPlugins.pluginName));
            }),

        createStaticFile: (data: Omit<CreateTraefikStaticFile, "id">) =>
            storage(database, async (db) => {
            const [staticFile] = await db.insert(traefikStaticFiles).values(data).returning();
            return staticFile;
            }),

        getStaticFilesByProject: (projectId: string) =>
            storage(database, async (db) => {
            return await db.select().from(traefikStaticFiles).where(eq(traefikStaticFiles.projectId, projectId)).orderBy(asc(traefikStaticFiles.relativePath));
            }),

        getAllStaticFiles: () =>
            storage(database, async (db) => {
            return await db.select().from(traefikStaticFiles).orderBy(asc(traefikStaticFiles.relativePath));
            }),

        deleteStaticFile: (id: string) =>
            storage(database, async (db) => {
            await db.delete(traefikStaticFiles).where(eq(traefikStaticFiles.id, id));
            }),

        getStaticFileByPath: (projectId: string, relativePath: string) =>
            storage(database, async (db) => {
            const [staticFile] = await db
                .select()
                .from(traefikStaticFiles)
                .where(and(eq(traefikStaticFiles.projectId, projectId), eq(traefikStaticFiles.relativePath, relativePath)));
            return staticFile;
            }),

        createBackup: (data: Omit<CreateTraefikBackup, "id">) =>
            storage(database, async (db) => {
            const [backup] = await db.insert(traefikBackups).values(data).returning();
            return backup;
            }),

        getBackupsByProject: (projectId: string) =>
            storage(database, async (db) => {
            return await db.select().from(traefikBackups).where(eq(traefikBackups.projectId, projectId)).orderBy(desc(traefikBackups.createdAt));
            }),

        getAllBackups: () =>
            storage(database, async (db) => {
            return await db.select().from(traefikBackups).orderBy(desc(traefikBackups.createdAt));
            }),

        getTraefikConfigsByProject: (projectId: string) =>
            storage(database, async (db) => {
            return await db.select().from(traefikConfigs).where(eq(traefikConfigs.projectId, projectId)).orderBy(asc(traefikConfigs.configName));
            }),

        getTraefikConfigById: (configId: string) =>
            storage(database, async (db) => {
            const [result] = await db.select().from(traefikConfigs).where(eq(traefikConfigs.id, configId)).limit(1);

            return result ?? null;
            }),

        getAllTraefikConfigs: () =>
            storage(database, async (db) => {
            return await db.select().from(traefikConfigs).orderBy(asc(traefikConfigs.configName));
            }),

      /**
       * Get all Traefik configs that need syncing
       * (configs where updatedAt > lastSyncedAt OR lastSyncedAt IS NULL)
       */
        getTraefikConfigsNeedingSync: (isActive = true) =>
            storage(database, async (db) => {
            const baseConditions = [
                eq(traefikConfigs.requiresFile, true), // Only sync configs that require files
                // Either never synced OR updated since last sync
                or(isNull(traefikConfigs.lastSyncedAt), gt(traefikConfigs.updatedAt, traefikConfigs.lastSyncedAt)),
            ];

            if (isActive) {
                baseConditions.push(eq(traefikConfigs.isActive, true));
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
                .leftJoin(projects, eq(traefikConfigs.projectId, projects.id)) // Left join for standalone configs
                .where(and(...baseConditions))
                .orderBy(desc(traefikConfigs.updatedAt));
            }),

      /**
       * Get Traefik configs that need syncing for a specific project
       */
        getTraefikConfigsNeedingSyncByProject: (projectId: string, isActive = true) =>
            storage(database, async (db) => {
            const baseConditions = [
                eq(traefikConfigs.projectId, projectId),
                eq(traefikConfigs.requiresFile, true), // Only sync configs that require files
                // Either never synced OR updated since last sync
                or(isNull(traefikConfigs.lastSyncedAt), gt(traefikConfigs.updatedAt, traefikConfigs.lastSyncedAt)),
            ];

            if (isActive) {
                baseConditions.push(eq(traefikConfigs.isActive, true));
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
                .leftJoin(projects, eq(traefikConfigs.projectId, projects.id)) // Left join for project name
                .where(and(...baseConditions))
                .orderBy(desc(traefikConfigs.updatedAt));
            }),

      /**
       * Get standalone Traefik configs that need syncing
       */
        getStandaloneTraefikConfigsNeedingSync: (isActive = true) =>
            storage(database, async (db) => {
            const baseConditions = [
                eq(traefikConfigs.storageType, "standalone"),
                eq(traefikConfigs.requiresFile, true), // Only sync configs that require files
                // Either never synced OR updated since last sync
                or(isNull(traefikConfigs.lastSyncedAt), gt(traefikConfigs.updatedAt, traefikConfigs.lastSyncedAt)),
            ];

            if (isActive) {
                baseConditions.push(eq(traefikConfigs.isActive, true));
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
                .leftJoin(projects, eq(traefikConfigs.projectId, projects.id)) // Left join (null for standalone)
                .where(and(...baseConditions))
                .orderBy(desc(traefikConfigs.updatedAt));
            }),

        getStaticConfigByProject: (projectId: string) =>
            storage(database, async (db) => {
            const [config] = await db.select().from(traefikStaticConfigs).where(eq(traefikStaticConfigs.projectId, projectId));
            return config;
            }),
    };

    return {
        ...leaf,

        updateServiceConfig: (input: UpdateServiceConfigInput) =>
            Effect.gen(function* () {
                const updateData: Partial<UpdateServiceConfigInput> = { ...input };
                delete updateData.id;

                if (input.subdomain !== undefined || input.domain !== undefined) {
                    const existingConfig = yield* leaf.getServiceConfig(input.id);
                    if (existingConfig) {
                        const domain = input.domain ?? existingConfig.domain;
                        const subdomain = input.subdomain ?? existingConfig.subdomain;
                        updateData.fullDomain = subdomain ? `${subdomain}.${domain}` : domain;
                    }
                }

                updateData.updatedAt = new Date();

                const [updated] = yield* storage(database, (db) =>
                    db.update(traefikServiceConfigs).set(updateData).where(eq(traefikServiceConfigs.id, input.id)).returning(),
                );

                return updated ?? null;
            }),

        getCompleteServiceConfig: (configId: string) =>
            Effect.gen(function* () {
                const config = yield* leaf.getServiceConfig(configId);
                if (!config) return null;

                const [domainRoutes, serviceTargets, sslCertificates, configFiles, middlewares] = yield* Effect.all(
                    [
                        leaf.getDomainRoutesByConfigId(config.id, true),
                        leaf.getServiceTargetsByConfigId(config.id, true),
                        leaf.getSSLCertificatesByConfigId(config.id, true),
                        leaf.getConfigFilesByConfigId(config.id, true),
                        leaf.getMiddlewares(config.serviceId, false, true),
                    ],
                    { concurrency: "unbounded" },
                );

                return { ...config, domainRoutes, serviceTargets, sslCertificates, configFiles, middlewares };
            }),

        getHealthCheckSummary: () =>
            leaf.getAllServiceConfigs(true).pipe(
                Effect.flatMap((configs) =>
                    Effect.forEach(
                        configs,
                        (config) =>
                            leaf.getServiceTargetsByConfigId(config.id, true).pipe(
                                Effect.map((targets) => ({
                                    configId: config.id,
                                    serviceId: config.serviceId,
                                    domain: config.fullDomain,
                                    totalTargets: targets.length,
                                    healthyTargets: targets.filter((t) => t.healthStatus === "healthy").length,
                                    unhealthyTargets: targets.filter((t) => t.healthStatus === "unhealthy").length,
                                    unknownTargets: targets.filter((t) => t.healthStatus === "unknown").length,
                                })),
                            ),
                        { concurrency: "unbounded" },
                    ),
                ),
            ),
    };
}

export type TraefikRepositoryShape = ReturnType<typeof makeTraefikRepository>;

export class TraefikRepository extends Context.Service<TraefikRepository, TraefikRepositoryShape>()("shared/TraefikRepository") {}
