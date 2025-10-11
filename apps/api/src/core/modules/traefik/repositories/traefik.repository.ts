import { Injectable } from "@nestjs/common";
import { eq, and, desc, asc, isNotNull, inArray, or, isNull, gt } from "drizzle-orm";
import { DatabaseService } from "@/core/modules/database/services/database.service";
import {
  traefikServiceConfigs,
  traefikDomainRoutes,
  traefikServiceTargets,
  traefikConfigFiles,
  traefikMiddlewares,
} from "@/config/drizzle/schema/traefik-service";
import {
  traefikSslCertificates,
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
} from "@/config/drizzle/schema/traefik";
import {
  services,
  projects,
} from "@/config/drizzle/schema/deployment";

export interface CreateServiceConfigInput {
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

export interface UpdateServiceConfigInput
  extends Partial<CreateServiceConfigInput> {
  id: string;
}

export interface CreateDomainRouteInput {
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

export interface CreateServiceTargetInput {
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

export interface CreateSSLCertificateInput {
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

export interface CreateConfigFileInput {
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

export interface CreateMiddlewareInput {
  name: string;
  type:
    | "auth"
    | "compression"
    | "headers"
    | "ratelimit"
    | "redirect"
    | "custom";
  config: any;
  description?: string;
  isGlobal?: boolean;
  serviceId?: string;
  isActive?: boolean;
}

@Injectable()
export class TraefikRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  // ============================================================================
  // PROJECT UTILITIES
  // ============================================================================

  async getProjectIdByName(projectName: string): Promise<string | null> {
    const result = await this.databaseService.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.name, projectName))
      .limit(1);

    return result.length > 0 ? result[0].id : null;
  }

  // ============================================================================
  // SERVICE CONFIGURATIONS
  // ============================================================================

  async createServiceConfig(input: CreateServiceConfigInput) {
    const fullDomain = input.subdomain
      ? `${input.subdomain}.${input.domain}`
      : input.domain;

    const [config] = await this.databaseService.db
      .insert(traefikServiceConfigs)
      .values({
        ...input,
        fullDomain,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return config;
  }

  async getServiceConfig(id: string) {
    const [config] = await this.databaseService.db
      .select()
      .from(traefikServiceConfigs)
      .where(eq(traefikServiceConfigs.id, id));

    return config;
  }

  async getServiceConfigByServiceId(serviceId: string) {
    const [config] = await this.databaseService.db
      .select()
      .from(traefikServiceConfigs)
      .where(eq(traefikServiceConfigs.serviceId, serviceId));

    return config;
  }

  async getAllServiceConfigs(isActive?: boolean) {
    const query = this.databaseService.db
      .select()
      .from(traefikServiceConfigs)
      .orderBy(desc(traefikServiceConfigs.createdAt));

    if (isActive !== undefined) {
      query.where(eq(traefikServiceConfigs.isActive, isActive));
    }

    return await query;
  }

  async getServiceConfigsByDomain(domain: string, isActive?: boolean) {
    const conditions = [eq(traefikServiceConfigs.domain, domain)];

    if (isActive !== undefined) {
      conditions.push(eq(traefikServiceConfigs.isActive, isActive));
    }

    return await this.databaseService.db
      .select()
      .from(traefikServiceConfigs)
      .where(and(...conditions))
      .orderBy(desc(traefikServiceConfigs.createdAt));
  }

  async getServiceConfigsByProject(projectId: string, isActive?: boolean) {
    // Get all services for the project first
    const projectServices = await this.databaseService.db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.projectId, projectId));

    const serviceIds = projectServices.map((service) => service.id);

    if (serviceIds.length === 0) {
      return [];
    }

    // Get all Traefik configurations for these services
    const conditions = [inArray(traefikServiceConfigs.serviceId, serviceIds)];

    if (isActive !== undefined) {
      conditions.push(eq(traefikServiceConfigs.isActive, isActive));
    }

    return await this.databaseService.db
      .select()
      .from(traefikServiceConfigs)
      .where(and(...conditions))
      .orderBy(desc(traefikServiceConfigs.createdAt));
  }

  async updateServiceConfig(input: UpdateServiceConfigInput) {
    const updateData: any = { ...input };
    delete updateData.id;

    if (input.subdomain !== undefined || input.domain !== undefined) {
      const existingConfig = await this.getServiceConfig(input.id);
      if (existingConfig) {
        const domain = input.domain || existingConfig.domain;
        const subdomain =
          input.subdomain !== undefined
            ? input.subdomain
            : existingConfig.subdomain;
        updateData.fullDomain = subdomain ? `${subdomain}.${domain}` : domain;
      }
    }

    updateData.updatedAt = new Date();

    const [updated] = await this.databaseService.db
      .update(traefikServiceConfigs)
      .set(updateData)
      .where(eq(traefikServiceConfigs.id, input.id))
      .returning();

    return updated;
  }

  async deleteServiceConfig(id: string) {
    // First delete dependent records to avoid foreign key constraints
    
    // Delete config files that reference this service config
    await this.databaseService.db
      .delete(traefikConfigFiles)
      .where(eq(traefikConfigFiles.configId, id));
    
    // Delete domain routes that reference this service config
    await this.databaseService.db
      .delete(traefikDomainRoutes)
      .where(eq(traefikDomainRoutes.configId, id));
    
    // Delete service targets that reference this service config
    await this.databaseService.db
      .delete(traefikServiceTargets)
      .where(eq(traefikServiceTargets.configId, id));
    
    // Now delete the service config itself
    const [deletedConfig] = await this.databaseService.db
      .delete(traefikServiceConfigs)
      .where(eq(traefikServiceConfigs.id, id))
      .returning();
    
    return deletedConfig;
  }

  async updateConfigSyncStatus(configId: string, lastSyncedAt: Date) {
    const [updated] = await this.databaseService.db
      .update(traefikServiceConfigs)
      .set({
        lastSyncedAt,
        updatedAt: new Date(),
      })
      .where(eq(traefikServiceConfigs.id, configId))
      .returning();

    return updated;
  }

  /**
   * Update sync status for traefikConfigs table (virtual filesystem)
   */
  async updateTraefikConfigSyncStatus(configId: string, lastSyncedAt: Date) {
    const [updated] = await this.databaseService.db
      .update(traefikConfigs)
      .set({
        lastSyncedAt,
        syncStatus: 'synced',
        syncErrorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(traefikConfigs.id, configId))
      .returning();

    return updated;
  }

  /**
   * Mark a traefikConfig as failed to sync
   */
  async markTraefikConfigSyncFailed(configId: string, errorMessage: string) {
    const [updated] = await this.databaseService.db
      .update(traefikConfigs)
      .set({
        syncStatus: 'failed',
        syncErrorMessage: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(traefikConfigs.id, configId))
      .returning();

    return updated;
  }

  // ============================================================================
  // DOMAIN ROUTES
  // ============================================================================

  async createDomainRoute(input: CreateDomainRouteInput) {
    const [route] = await this.databaseService.db
      .insert(traefikDomainRoutes)
      .values({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return route;
  }

  async getDomainRoutesByConfigId(configId: string, isActive?: boolean) {
    const conditions = [eq(traefikDomainRoutes.configId, configId)];

    if (isActive !== undefined) {
      conditions.push(eq(traefikDomainRoutes.isActive, isActive));
    }

    return await this.databaseService.db
      .select()
      .from(traefikDomainRoutes)
      .where(and(...conditions))
      .orderBy(desc(traefikDomainRoutes.priority));
  }

  async updateDomainRoute(id: string, input: Partial<CreateDomainRouteInput>) {
    const [updated] = await this.databaseService.db
      .update(traefikDomainRoutes)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(traefikDomainRoutes.id, id))
      .returning();

    return updated;
  }

  async deleteDomainRoute(id: string) {
    const [deleted] = await this.databaseService.db
      .delete(traefikDomainRoutes)
      .where(eq(traefikDomainRoutes.id, id))
      .returning();

    return deleted;
  }

  // ============================================================================
  // SERVICE TARGETS
  // ============================================================================

  async createServiceTarget(input: CreateServiceTargetInput) {
    const [target] = await this.databaseService.db
      .insert(traefikServiceTargets)
      .values({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return target;
  }

  async getServiceTargetsByConfigId(configId: string, isActive?: boolean) {
    const conditions = [eq(traefikServiceTargets.configId, configId)];

    if (isActive !== undefined) {
      conditions.push(eq(traefikServiceTargets.isActive, isActive));
    }

    return await this.databaseService.db
      .select()
      .from(traefikServiceTargets)
      .where(and(...conditions))
      .orderBy(desc(traefikServiceTargets.weight));
  }

  async updateServiceTarget(
    id: string,
    input: Partial<CreateServiceTargetInput>
  ) {
    const [updated] = await this.databaseService.db
      .update(traefikServiceTargets)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(traefikServiceTargets.id, id))
      .returning();

    return updated;
  }

  async updateServiceTargetHealth(
    id: string,
    healthStatus: "healthy" | "unhealthy" | "unknown"
  ) {
    const [updated] = await this.databaseService.db
      .update(traefikServiceTargets)
      .set({
        healthStatus,
        lastHealthCheck: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(traefikServiceTargets.id, id))
      .returning();

    return updated;
  }

  async deleteServiceTarget(id: string) {
    const [deleted] = await this.databaseService.db
      .delete(traefikServiceTargets)
      .where(eq(traefikServiceTargets.id, id))
      .returning();

    return deleted;
  }

  // ============================================================================
  // SSL CERTIFICATES
  // ============================================================================

  async createSSLCertificate(input: CreateSSLCertificateInput) {
    const [certificate] = await this.databaseService.db
      .insert(traefikSslCertificates)
      .values({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return certificate;
  }

  async getSSLCertificatesByConfigId(configId: string, isActive?: boolean) {
    const conditions = [eq(traefikSslCertificates.configId, configId)];

    if (isActive !== undefined) {
      conditions.push(eq(traefikSslCertificates.isActive, isActive));
    }

    return await this.databaseService.db
      .select()
      .from(traefikSslCertificates)
      .where(and(...conditions))
      .orderBy(desc(traefikSslCertificates.notAfter));
  }

  async getExpiringCertificates(days: number = 30) {
    const expiryThreshold = new Date();
    expiryThreshold.setDate(expiryThreshold.getDate() + days);

    return await this.databaseService.db
      .select()
      .from(traefikSslCertificates)
      .where(
        and(
          eq(traefikSslCertificates.isActive, true),
          eq(traefikSslCertificates.autoRenew, true),
          isNotNull(traefikSslCertificates.notAfter)
        )
      )
      .orderBy(asc(traefikSslCertificates.notAfter));
  }

  async updateSSLCertificate(
    id: string,
    input: Partial<CreateSSLCertificateInput>
  ) {
    const [updated] = await this.databaseService.db
      .update(traefikSslCertificates)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(traefikSslCertificates.id, id))
      .returning();

    return updated;
  }

  async deleteSSLCertificate(id: string) {
    const [deleted] = await this.databaseService.db
      .delete(traefikSslCertificates)
      .where(eq(traefikSslCertificates.id, id))
      .returning();

    return deleted;
  }

  // ============================================================================
  // CONFIG FILES
  // ============================================================================

  async createConfigFile(input: CreateConfigFileInput) {
    const [file] = await this.databaseService.db
      .insert(traefikConfigFiles)
      .values({
        ...input,
        syncStatus: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return file;
  }

  async getConfigFilesByConfigId(configId: string, isActive?: boolean) {
    const conditions = [eq(traefikConfigFiles.configId, configId)];

    if (isActive !== undefined) {
      conditions.push(eq(traefikConfigFiles.isActive, isActive));
    }

    return await this.databaseService.db
      .select()
      .from(traefikConfigFiles)
      .where(and(...conditions))
      .orderBy(desc(traefikConfigFiles.createdAt));
  }

  async getConfigFilesByStatus(status: "pending" | "synced" | "error") {
    return await this.databaseService.db
      .select()
      .from(traefikConfigFiles)
      .where(
        and(
          eq(traefikConfigFiles.syncStatus, status),
          eq(traefikConfigFiles.isActive, true)
        )
      )
      .orderBy(desc(traefikConfigFiles.createdAt));
  }

  async updateConfigFile(
    id: string,
    input: Partial<
      CreateConfigFileInput & {
        syncStatus?: "pending" | "synced" | "error";
        syncError?: string;
        lastSynced?: Date;
      }
    >
  ) {
    const [updated] = await this.databaseService.db
      .update(traefikConfigFiles)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(traefikConfigFiles.id, id))
      .returning();

    return updated;
  }

  async updateConfigFileSyncStatus(
    id: string,
    syncStatus: "pending" | "synced" | "error",
    syncError?: string
  ) {
    const [updated] = await this.databaseService.db
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
  }

  async deleteConfigFile(id: string) {
    const [deleted] = await this.databaseService.db
      .delete(traefikConfigFiles)
      .where(eq(traefikConfigFiles.id, id))
      .returning();

    return deleted;
  }

  // ============================================================================
  // MIDDLEWARES
  // ============================================================================

  async createMiddleware(input: CreateMiddlewareInput) {
    const [middleware] = await this.databaseService.db
      .insert(traefikMiddlewares)
      .values({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return middleware;
  }

  async getMiddlewares(
    serviceId?: string,
    isGlobal?: boolean,
    isActive?: boolean
  ) {
    const conditions: any[] = [];

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
      return await this.databaseService.db
        .select()
        .from(traefikMiddlewares)
        .where(and(...conditions))
        .orderBy(desc(traefikMiddlewares.createdAt));
    } else {
      return await this.databaseService.db
        .select()
        .from(traefikMiddlewares)
        .orderBy(desc(traefikMiddlewares.createdAt));
    }
  }

  async getMiddleware(id: string) {
    const [middleware] = await this.databaseService.db
      .select()
      .from(traefikMiddlewares)
      .where(eq(traefikMiddlewares.id, id));

    return middleware;
  }

  async updateMiddleware(id: string, input: Partial<CreateMiddlewareInput>) {
    const [updated] = await this.databaseService.db
      .update(traefikMiddlewares)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(traefikMiddlewares.id, id))
      .returning();

    return updated;
  }

  async deleteMiddleware(id: string) {
    const [deleted] = await this.databaseService.db
      .delete(traefikMiddlewares)
      .where(eq(traefikMiddlewares.id, id))
      .returning();

    return deleted;
  }

  // ============================================================================
  // COMPLEX QUERIES & AGGREGATIONS
  // ============================================================================

  async getCompleteServiceConfig(configId: string) {
    // Get main config
    const config = await this.getServiceConfig(configId);
    if (!config) return null;

    // Get all related data
    const [
      domainRoutes,
      serviceTargets,
      sslCertificates,
      configFiles,
      middlewares,
    ] = await Promise.all([
      this.getDomainRoutesByConfigId(config.id, true),
      this.getServiceTargetsByConfigId(config.id, true),
      this.getSSLCertificatesByConfigId(config.id, true),
      this.getConfigFilesByConfigId(config.id, true),
      this.getMiddlewares(config.serviceId, false, true),
    ]);

    return {
      ...config,
      domainRoutes,
      serviceTargets,
      sslCertificates,
      configFiles,
      middlewares,
    };
  }

  async getServiceConfigsNeedingSync() {
    return await this.databaseService.db
      .select()
      .from(traefikServiceConfigs)
      .where(
        and(
          eq(traefikServiceConfigs.isActive, true),
          eq(traefikConfigFiles.syncStatus, "pending")
        )
      )
      .leftJoin(
        traefikConfigFiles,
        eq(traefikServiceConfigs.id, traefikConfigFiles.configId)
      )
      .orderBy(desc(traefikServiceConfigs.updatedAt));
  }

  async getHealthCheckSummary() {
    const configs = await this.getAllServiceConfigs(true);
    const healthChecks = await Promise.all(
      configs.map(async (config) => {
        const targets = await this.getServiceTargetsByConfigId(config.id, true);
        return {
          configId: config.id,
          serviceId: config.serviceId,
          domain: config.fullDomain,
          totalTargets: targets.length,
          healthyTargets: targets.filter((t) => t.healthStatus === "healthy")
            .length,
          unhealthyTargets: targets.filter(
            (t) => t.healthStatus === "unhealthy"
          ).length,
          unknownTargets: targets.filter((t) => t.healthStatus === "unknown")
            .length,
        };
      })
    );

    return healthChecks;
  }

  // ============================================================================
  // SERVICE AND PROJECT HELPERS
  // ============================================================================

  async getServiceById(serviceId: string) {
    const [service] = await this.databaseService.db
      .select()
      .from(services)
      .where(eq(services.id, serviceId));

    return service;
  }

  async getProjectById(projectId: string) {
    const [project] = await this.databaseService.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));

    return project;
  }

  // ============================================================================
  // FILE SYSTEM SUPPORT METHODS
  // ============================================================================

  /**
   * Get all projects for file system structure
   */
  async getAllProjects() {
    return await this.databaseService.db
      .select({
        id: projects.id,
        name: projects.name,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .orderBy(asc(projects.name));
  }

  /**
   * Get all config files for file system structure
   */
  async getAllConfigFiles(isActive?: boolean) {
    const conditions =
      isActive !== undefined ? [eq(traefikConfigFiles.isActive, isActive)] : [];

    return await this.databaseService.db
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
  }

  /**
   * Get config files by project for file system structure
   */
  async getConfigFilesByProject(projectId: string, isActive?: boolean) {
    const conditions = [eq(services.projectId, projectId)];

    if (isActive !== undefined) {
      conditions.push(eq(traefikConfigFiles.isActive, isActive));
    }

    return await this.databaseService.db
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
        eq(traefikConfigFiles.configId, traefikServiceConfigs.id)
      )
      .innerJoin(services, eq(traefikServiceConfigs.serviceId, services.id))
      .innerJoin(projects, eq(services.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(asc(traefikConfigFiles.relativePath));
  }

  /**
   * Get config file by path for content retrieval
   */
  async getConfigFileByPath(relativePath: string, isActive?: boolean) {
    const conditions = [eq(traefikConfigFiles.relativePath, relativePath)];

    if (isActive !== undefined) {
      conditions.push(eq(traefikConfigFiles.isActive, isActive));
    }

    const [configFile] = await this.databaseService.db
      .select()
      .from(traefikConfigFiles)
      .where(and(...conditions));

    return configFile;
  }

  // ============================================================================
  // SSL CERTIFICATES METHODS (new schema)
  // ============================================================================

  async createNewSslCertificate(data: Omit<CreateTraefikSslCertificate, "id">) {
    const [certificate] = await this.databaseService.db
      .insert(traefikSslCertificates)
      .values(data)
      .returning();
    return certificate;
  }

  async getNewSslCertificatesByProject(projectId: string) {
    // Get SSL certificates by joining with service configs and services to find those belonging to a project
    return await this.databaseService.db
      .select()
      .from(traefikSslCertificates)
      .innerJoin(traefikServiceConfigs, eq(traefikSslCertificates.configId, traefikServiceConfigs.id))
      .innerJoin(services, eq(traefikServiceConfigs.serviceId, services.id))
      .where(eq(services.projectId, projectId))
      .orderBy(asc(traefikSslCertificates.domain));
  }

  async getAllNewSslCertificates() {
    return await this.databaseService.db
      .select()
      .from(traefikSslCertificates)
      .orderBy(asc(traefikSslCertificates.domain));
  }

  // ============================================================================
  // MIDDLEWARE METHODS (new schema)
  // ============================================================================

  async createNewMiddleware(data: Omit<CreateTraefikMiddleware, "id">) {
    const [middleware] = await this.databaseService.db
      .insert(traefikMiddleware)
      .values(data)
      .returning();
    return middleware;
  }

  async getNewMiddlewareByProject(projectId: string) {
    return await this.databaseService.db
      .select()
      .from(traefikMiddleware)
      .where(eq(traefikMiddleware.projectId, projectId))
      .orderBy(asc(traefikMiddleware.middlewareName));
  }

  async getGlobalNewMiddleware() {
    return await this.databaseService.db
      .select()
      .from(traefikMiddleware)
      .where(eq(traefikMiddleware.isGlobal, true))
      .orderBy(asc(traefikMiddleware.middlewareName));
  }

  async getAllNewMiddleware() {
    return await this.databaseService.db
      .select()
      .from(traefikMiddleware)
      .orderBy(asc(traefikMiddleware.middlewareName));
  }

  // ============================================================================
  // PLUGINS METHODS
  // ============================================================================

  async createPlugin(data: Omit<CreateTraefikPlugin, "id">) {
    const [plugin] = await this.databaseService.db
      .insert(traefikPlugins)
      .values(data)
      .returning();
    return plugin;
  }

  async getPluginsByProject(projectId: string) {
    return await this.databaseService.db
      .select()
      .from(traefikPlugins)
      .where(eq(traefikPlugins.projectId, projectId))
      .orderBy(asc(traefikPlugins.pluginName));
  }

  async getAllPlugins() {
    return await this.databaseService.db
      .select()
      .from(traefikPlugins)
      .orderBy(asc(traefikPlugins.pluginName));
  }

  // ============================================================================
  // STATIC FILES METHODS
  // ============================================================================

  async createStaticFile(data: Omit<CreateTraefikStaticFile, "id">) {
    const [staticFile] = await this.databaseService.db
      .insert(traefikStaticFiles)
      .values(data)
      .returning();
    return staticFile;
  }

  async getStaticFilesByProject(projectId: string) {
    return await this.databaseService.db
      .select()
      .from(traefikStaticFiles)
      .where(eq(traefikStaticFiles.projectId, projectId))
      .orderBy(asc(traefikStaticFiles.relativePath));
  }

  async getAllStaticFiles() {
    return await this.databaseService.db
      .select()
      .from(traefikStaticFiles)
      .orderBy(asc(traefikStaticFiles.relativePath));
  }

  async getStaticFileByPath(projectId: string, relativePath: string) {
    const [staticFile] = await this.databaseService.db
      .select()
      .from(traefikStaticFiles)
      .where(
        and(
          eq(traefikStaticFiles.projectId, projectId),
          eq(traefikStaticFiles.relativePath, relativePath)
        )
      );
    return staticFile;
  }

  // ============================================================================
  // BACKUPS METHODS
  // ============================================================================

  async createBackup(data: Omit<CreateTraefikBackup, "id">) {
    const [backup] = await this.databaseService.db
      .insert(traefikBackups)
      .values(data)
      .returning();
    return backup;
  }

  async getBackupsByProject(projectId: string) {
    return await this.databaseService.db
      .select()
      .from(traefikBackups)
      .where(eq(traefikBackups.projectId, projectId))
      .orderBy(desc(traefikBackups.createdAt));
  }

  async getAllBackups() {
    return await this.databaseService.db
      .select()
      .from(traefikBackups)
      .orderBy(desc(traefikBackups.createdAt));
  }

  // ============================================================================
  // NEW TRAEFIK CONFIGS METHODS (from main schema)
  // ============================================================================

  async getTraefikConfigsByProject(projectId: string) {
    return await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(eq(traefikConfigs.projectId, projectId))
      .orderBy(asc(traefikConfigs.configName));
  }

  async getTraefikConfigById(configId: string) {
    const result = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(eq(traefikConfigs.id, configId))
      .limit(1);
    
    return result[0] || null;
  }

  async getAllTraefikConfigs() {
    return await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .orderBy(asc(traefikConfigs.configName));
  }

  /**
   * Get all Traefik configs that need syncing
   * (configs where updatedAt > lastSyncedAt OR lastSyncedAt IS NULL)
   */
  async getTraefikConfigsNeedingSync(isActive: boolean = true) {
    const baseConditions = [
      eq(traefikConfigs.requiresFile, true), // Only sync configs that require files
      // Either never synced OR updated since last sync
      or(
        isNull(traefikConfigs.lastSyncedAt),
        gt(traefikConfigs.updatedAt, traefikConfigs.lastSyncedAt)
      )
    ];
    
    if (isActive) {
      baseConditions.push(eq(traefikConfigs.isActive, true));
    }
    
    return await this.databaseService.db
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
  }

  /**
   * Get Traefik configs that need syncing for a specific project
   */
  async getTraefikConfigsNeedingSyncByProject(projectId: string, isActive: boolean = true) {
    const baseConditions = [
      eq(traefikConfigs.projectId, projectId),
      eq(traefikConfigs.requiresFile, true), // Only sync configs that require files
      // Either never synced OR updated since last sync
      or(
        isNull(traefikConfigs.lastSyncedAt),
        gt(traefikConfigs.updatedAt, traefikConfigs.lastSyncedAt)
      )
    ];
    
    if (isActive) {
      baseConditions.push(eq(traefikConfigs.isActive, true));
    }
    
    return await this.databaseService.db
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
  }

  /**
   * Get standalone Traefik configs that need syncing
   */
  async getStandaloneTraefikConfigsNeedingSync(isActive: boolean = true) {
    const baseConditions = [
      eq(traefikConfigs.storageType, 'standalone'),
      eq(traefikConfigs.requiresFile, true), // Only sync configs that require files
      // Either never synced OR updated since last sync
      or(
        isNull(traefikConfigs.lastSyncedAt),
        gt(traefikConfigs.updatedAt, traefikConfigs.lastSyncedAt)
      )
    ];
    
    if (isActive) {
      baseConditions.push(eq(traefikConfigs.isActive, true));
    }
    
    return await this.databaseService.db
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
  }

  async getStaticConfigByProject(projectId: string) {
    const [config] = await this.databaseService.db
      .select()
      .from(traefikStaticConfigs)
      .where(eq(traefikStaticConfigs.projectId, projectId));
    return config;
  }
}
