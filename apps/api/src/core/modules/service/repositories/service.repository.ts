import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { services, deployments, deploymentLogs, projects, serviceDependencies, serviceHealthConfigs, traefikServiceConfigs } from '@/config/drizzle/schema';
import { eq, and, desc, like, inArray, count, ilike } from 'drizzle-orm';

// Types for service operations
export interface CreateServiceData {
    projectId: string;
    name: string;
    description?: string;
    type: string;
    
    // Provider configuration (registry-based)
    providerId: string; // Registry ID: "github", "static", etc.
    providerConfig?: Record<string, any>;
    
    // Builder configuration (registry-based)
    builderId: string; // Registry ID: "dockerfile", "nixpack", etc.
    builderConfig?: Record<string, any>;
    
    // Runtime configuration
    port?: number;
    environmentVariables?: Record<string, any>;
    resourceLimits?: {
        memory?: string;
        cpu?: string;
        storage?: string;
    };
    
    // Health & Monitoring
    healthCheckPath?: string;
    healthCheckInterval?: number;
    healthCheckTimeout?: number;
    healthCheckRetries?: number;
    
    // Deployment configuration
    deploymentRetention?: {
        maxSuccessfulDeployments?: number;
        keepArtifacts?: boolean;
        autoCleanup?: boolean;
        cleanupSchedule?: string;
    };
    
    // Routing & Network
    customDomains?: string[];
    
    // Metadata
    metadata?: {
        tags?: string[];
        category?: string;
        icon?: string;
        color?: string;
        customData?: Record<string, any>;
    };
}

export interface UpdateServiceData extends Partial<CreateServiceData> {
    isActive?: boolean;
}

export interface ServiceLogsFilter {
    level?: 'info' | 'warn' | 'error' | 'debug';
    phase?: string;
    step?: string;
    service?: string;
    stage?: string;
    startTime?: Date;
    endTime?: Date;
    search?: string;
}

@Injectable()
export class ServiceRepository {
    private readonly logger = new Logger(ServiceRepository.name);

    constructor(private readonly databaseService: DatabaseService) { }

    async findById(id: string) {
        this.logger.log(`Finding service by ID: ${id}`);
        const [service] = await this.databaseService.db
            .select()
            .from(services)
            .where(eq(services.id, id))
            .limit(1);

        return service || null;
    }

    async findByProject(projectId: string) {
        this.logger.log(`Finding services for project: ${projectId}`);
        return await this.databaseService.db
            .select()
            .from(services)
            .where(eq(services.projectId, projectId))
            .orderBy(desc(services.createdAt));
    }

    async create(data: CreateServiceData) {
        this.logger.log(`Creating service: ${data.name} in project: ${data.projectId}`);
        const [service] = await this.databaseService.db
            .insert(services)
            .values({
                projectId: data.projectId,
                name: data.name,
                description: data.description,
                type: data.type,
                providerId: data.providerId,
                providerConfig: data.providerConfig,
                builderId: data.builderId,
                builderConfig: data.builderConfig,
                port: data.port,
                environmentVariables: data.environmentVariables,
                resourceLimits: data.resourceLimits,
                healthCheckPath: data.healthCheckPath || '/health',
                healthCheckInterval: data.healthCheckInterval,
                healthCheckTimeout: data.healthCheckTimeout,
                healthCheckRetries: data.healthCheckRetries,
                deploymentRetention: data.deploymentRetention,
                customDomains: data.customDomains,
                metadata: data.metadata,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();

        return service;
    }

    async update(id: string, data: UpdateServiceData) {
        this.logger.log(`Updating service: ${id}`);
        const [service] = await this.databaseService.db
            .update(services)
            .set({
            ...data,
            updatedAt: new Date(),
        })
            .where(eq(services.id, id))
            .returning();

        return service;
    }

    async delete(id: string) {
        this.logger.log(`Deleting service: ${id}`);
        await this.databaseService.db
            .delete(services)
            .where(eq(services.id, id));

        return true;
    }

    async findActiveDeployments(serviceId: string) {
        this.logger.log(`Finding active deployments for service: ${serviceId}`);
        return await this.databaseService.db
            .select()
            .from(deployments)
            .where(and(eq(deployments.serviceId, serviceId), inArray(deployments.status, ['success', 'building', 'deploying'])))
            .orderBy(desc(deployments.createdAt));
    }

    async findDeploymentLogs(deploymentId: string, filter: ServiceLogsFilter = {}, limit = 100, offset = 0) {
        this.logger.log(`Finding deployment logs for: ${deploymentId}`);

        // Build the WHERE conditions
        const conditions = [eq(deploymentLogs.deploymentId, deploymentId)];

        if (filter.level) {
            conditions.push(eq(deploymentLogs.level, filter.level as any));
        }
        if (filter.phase) {
            conditions.push(eq(deploymentLogs.phase, filter.phase));
        }
        if (filter.service) {
            conditions.push(eq(deploymentLogs.service, filter.service));
        }
        if (filter.search) {
            conditions.push(like(deploymentLogs.message, `%${filter.search}%`));
        }

        const logs = await this.databaseService.db
            .select()
            .from(deploymentLogs)
            .where(and(...conditions))
            .orderBy(desc(deploymentLogs.timestamp))
            .limit(limit)
            .offset(offset);

        return logs;
    }

    async createDeploymentLog(data: {
        deploymentId: string;
        level: 'info' | 'warn' | 'error' | 'debug';
        message: string;
        phase?: string;
        step?: string;
        service?: string;
        stage?: string;
        metadata?: Record<string, any>;
    }) {
        this.logger.log(`Creating deployment log for: ${data.deploymentId}`);
        const [log] = await this.databaseService.db
            .insert(deploymentLogs)
            .values({
            deploymentId: data.deploymentId,
            level: data.level,
            message: data.message,
            phase: data.phase,
            step: data.step,
            service: data.service,
            stage: data.stage,
            metadata: data.metadata,
            timestamp: new Date(),
        })
            .returning();

        return log;
    }

    async findServiceDependencies(serviceId: string) {
        this.logger.log(`Finding dependencies for service: ${serviceId}`);
        return await this.databaseService.db
            .select({
            id: serviceDependencies.id,
            serviceId: serviceDependencies.serviceId,
            dependsOnServiceId: serviceDependencies.dependsOnServiceId,
            isRequired: serviceDependencies.isRequired,
            createdAt: serviceDependencies.createdAt, // Add createdAt to match contract
            dependsOnService: { // Rename from dependentService to dependsOnService to match contract
                id: services.id,
                name: services.name,
                type: services.type,
            }
        })
            .from(serviceDependencies)
            .innerJoin(services, eq(serviceDependencies.dependsOnServiceId, services.id))
            .where(eq(serviceDependencies.serviceId, serviceId));
    }

    async createServiceDependency(serviceId: string, dependsOnServiceId: string, isRequired = true) {
        this.logger.log(`Creating dependency: ${serviceId} depends on ${dependsOnServiceId}`);
        const [dependency] = await this.databaseService.db
            .insert(serviceDependencies)
            .values({
            serviceId,
            dependsOnServiceId,
            isRequired,
            createdAt: new Date(),
        })
            .returning();

        return dependency;
    }

    async removeServiceDependency(serviceId: string, dependsOnServiceId: string) {
        this.logger.log(`Removing dependency: ${serviceId} -> ${dependsOnServiceId}`);
        await this.databaseService.db
            .delete(serviceDependencies)
            .where(and(eq(serviceDependencies.serviceId, serviceId), eq(serviceDependencies.dependsOnServiceId, dependsOnServiceId)));

        return true;
    }

    async findServicesByProject(projectId: string, activeOnly = false) {
        this.logger.log(`Finding services for project: ${projectId}, activeOnly: ${activeOnly}`);

        // Build the WHERE conditions
        const conditions = [eq(services.projectId, projectId)];
        if (activeOnly) {
            conditions.push(eq(services.isActive, true));
        }

        const query = this.databaseService.db
            .select({
            id: services.id,
            name: services.name,
            type: services.type,
            providerId: services.providerId,
            builderId: services.builderId,
            port: services.port,
            isActive: services.isActive,
            createdAt: services.createdAt,
            updatedAt: services.updatedAt,
            project: {
                id: projects.id,
                name: projects.name,
            }
        })
            .from(services)
            .innerJoin(projects, eq(services.projectId, projects.id))
            .where(and(...conditions));

        return await query.orderBy(desc(services.createdAt));
    }

    async getProjectDependencyGraph(projectId: string) {
        this.logger.log(`Getting dependency graph for project: ${projectId}`);
        
        // Get all services for the project
        const projectServices = await this.databaseService.db
            .select({
                id: services.id,
                name: services.name,
                type: services.type,
                port: services.port,
                isActive: services.isActive,
                projectId: services.projectId,
            })
            .from(services)
            .where(eq(services.projectId, projectId));

        // Get all dependencies between these services
        const serviceIds = projectServices.map(s => s.id);
        const dependencies = serviceIds.length > 0 ? await this.databaseService.db
            .select({
                id: serviceDependencies.id,
                serviceId: serviceDependencies.serviceId,
                dependsOnServiceId: serviceDependencies.dependsOnServiceId,
                isRequired: serviceDependencies.isRequired,
                createdAt: serviceDependencies.createdAt,
            })
            .from(serviceDependencies)
            .where(
                and(
                    inArray(serviceDependencies.serviceId, serviceIds),
                    inArray(serviceDependencies.dependsOnServiceId, serviceIds)
                )
            ) : [];

        // Get project info
        const project = await this.databaseService.db
            .select({
                id: projects.id,
                name: projects.name,
                baseDomain: projects.baseDomain,
            })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        // Get latest deployment for each service (for status)
        const latestDeployments = serviceIds.length > 0 ? await this.databaseService.db
            .select({
                id: deployments.id,
                serviceId: deployments.serviceId,
                status: deployments.status,
                environment: deployments.environment,
                createdAt: deployments.createdAt,
                domainUrl: deployments.domainUrl,
            })
            .from(deployments)
            .where(inArray(deployments.serviceId, serviceIds))
            .orderBy(desc(deployments.createdAt)) : [];

        // Group deployments by service and get the latest one for each
        const latestDeploymentByService = latestDeployments.reduce((acc, deployment) => {
            if (!acc[deployment.serviceId]) {
                acc[deployment.serviceId] = deployment;
            }
            return acc;
        }, {} as Record<string, typeof latestDeployments[0]>);

        return {
            services: projectServices,
            dependencies,
            project: project[0] || null,
            latestDeployments: latestDeploymentByService,
        };
    }

    async listServicesByProjectWithStats(
        projectId: string,
        filters: {
            search?: string;
            type?: string;
            isActive?: boolean;
            limit?: number;
            offset?: number;
        } = {}
    ) {
        this.logger.log(`Listing services with stats for project: ${projectId}`);

        const limit = filters.limit || 20;
        const offset = filters.offset || 0;

        // Build conditions
        const conditions = [eq(services.projectId, projectId)];
        if (filters.search) {
            conditions.push(ilike(services.name, `%${filters.search}%`));
        }
        if (filters.type) {
            conditions.push(eq(services.type, filters.type));
        }
        if (filters.isActive !== undefined) {
            conditions.push(eq(services.isActive, filters.isActive));
        }

        const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

        // Get services with project and health check config
        const serviceList = await this.databaseService.db
            .select({
                service: services,
                healthCheckConfig: serviceHealthConfigs,
                project: {
                    id: projects.id,
                    name: projects.name,
                    baseDomain: projects.baseDomain,
                },
            })
            .from(services)
            .innerJoin(projects, eq(services.projectId, projects.id))
            .leftJoin(serviceHealthConfigs, eq(services.id, serviceHealthConfigs.serviceId))
            .where(whereClause)
            .orderBy(desc(services.createdAt))
            .limit(limit)
            .offset(offset);

        // Get total count
        const countResult = await this.databaseService.db
            .select({ count: count() })
            .from(services)
            .where(whereClause);

        const total = countResult[0]?.count ?? 0;

        // Get service IDs for batch queries
        const serviceIds = serviceList.map(({ service }) => service.id);

        let deploymentCountMap = new Map<string, number>();
        let dependencyCountMap = new Map<string, number>();
        let latestByService = new Map<string, any>();

        if (serviceIds.length > 0) {
            // Get deployment counts
            const deploymentCounts = await this.databaseService.db
                .select({
                    serviceId: deployments.serviceId,
                    count: count(),
                })
                .from(deployments)
                .where(inArray(deployments.serviceId, serviceIds))
                .groupBy(deployments.serviceId);

            // Get latest deployments
            const latestDeployments = await this.databaseService.db
                .select({
                    serviceId: deployments.serviceId,
                    id: deployments.id,
                    status: deployments.status,
                    environment: deployments.environment,
                    createdAt: deployments.createdAt,
                    domainUrl: deployments.domainUrl,
                })
                .from(deployments)
                .where(inArray(deployments.serviceId, serviceIds))
                .orderBy(desc(deployments.createdAt));

            // Group by service
            latestDeployments.forEach(deployment => {
                if (!latestByService.has(deployment.serviceId)) {
                    latestByService.set(deployment.serviceId, deployment);
                }
            });

            // Get dependency counts
            const dependencyCounts = await this.databaseService.db
                .select({
                    serviceId: serviceDependencies.serviceId,
                    count: count(),
                })
                .from(serviceDependencies)
                .where(inArray(serviceDependencies.serviceId, serviceIds))
                .groupBy(serviceDependencies.serviceId);

            deploymentCountMap = new Map(deploymentCounts.map(dc => [dc.serviceId, Number(dc.count)]));
            dependencyCountMap = new Map(dependencyCounts.map(dc => [dc.serviceId, Number(dc.count)]));
        }

        return {
            services: serviceList,
            deploymentCounts: deploymentCountMap,
            dependencyCounts: dependencyCountMap,
            latestDeployments: latestByService,
            total: Number(total),
            hasMore: offset + limit < Number(total),
        };
    }

    async getServiceWithDetails(serviceId: string) {
        this.logger.log(`Getting service with details: ${serviceId}`);

        const result = await this.databaseService.db
            .select({
                service: services,
                healthCheckConfig: serviceHealthConfigs,
                project: {
                    id: projects.id,
                    name: projects.name,
                    baseDomain: projects.baseDomain,
                },
            })
            .from(services)
            .innerJoin(projects, eq(services.projectId, projects.id))
            .leftJoin(serviceHealthConfigs, eq(services.id, serviceHealthConfigs.serviceId))
            .where(eq(services.id, serviceId))
            .limit(1);

        if (result.length === 0) {
            return null;
        }

        const { service, healthCheckConfig, project } = result[0];

        // Get deployment count
        const deploymentCountResult = await this.databaseService.db
            .select({ count: count() })
            .from(deployments)
            .where(eq(deployments.serviceId, serviceId));

        const deploymentCount = Number(deploymentCountResult[0]?.count ?? 0);

        // Get latest deployment
        const latestDeploymentResult = await this.databaseService.db
            .select({
                id: deployments.id,
                status: deployments.status,
                environment: deployments.environment,
                createdAt: deployments.createdAt,
                domainUrl: deployments.domainUrl,
            })
            .from(deployments)
            .where(eq(deployments.serviceId, serviceId))
            .orderBy(desc(deployments.createdAt))
            .limit(1);

        const latestDeployment = latestDeploymentResult[0] || null;

        // Get dependency count
        const dependencyCountResult = await this.databaseService.db
            .select({ count: count() })
            .from(serviceDependencies)
            .where(eq(serviceDependencies.serviceId, serviceId));

        const dependencyCount = Number(dependencyCountResult[0]?.count ?? 0);

        return {
            service,
            healthCheckConfig,
            project,
            stats: {
                deploymentCount,
                dependencyCount,
            },
            latestDeployment,
        };
    }

    async getServiceDeployments(
        serviceId: string,
        filters: {
            environment?: string;
            status?: string;
            limit?: number;
            offset?: number;
        } = {}
    ) {
        this.logger.log(`Getting deployments for service: ${serviceId}`);

        const limit = filters.limit || 20;
        const offset = filters.offset || 0;

        const conditions = [eq(deployments.serviceId, serviceId)];
        if (filters.environment) {
            conditions.push(eq(deployments.environment, filters.environment as any));
        }
        if (filters.status) {
            conditions.push(eq(deployments.status, filters.status as any));
        }

        const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

        const deploymentList = await this.databaseService.db
            .select()
            .from(deployments)
            .where(whereClause)
            .orderBy(desc(deployments.createdAt))
            .limit(limit)
            .offset(offset);

        const countResult = await this.databaseService.db
            .select({ count: count() })
            .from(deployments)
            .where(whereClause);

        const total = Number(countResult[0]?.count ?? 0);

        return {
            deployments: deploymentList,
            total,
            hasMore: offset + limit < total,
        };
    }

    async getAllServiceDeployments(serviceId: string) {
        this.logger.log(`Getting all deployments for service: ${serviceId}`);
        
        return await this.databaseService.db
            .select({
                id: deployments.id,
                status: deployments.status,
                environment: deployments.environment,
                containerName: deployments.containerName,
                createdAt: deployments.createdAt,
                deployCompletedAt: deployments.deployCompletedAt,
            })
            .from(deployments)
            .where(eq(deployments.serviceId, serviceId))
            .orderBy(desc(deployments.createdAt));
    }

    async getTraefikConfigByService(serviceId: string) {
        this.logger.log(`Getting Traefik config for service: ${serviceId}`);

        const result = await this.databaseService.db
            .select()
            .from(traefikServiceConfigs)
            .where(eq(traefikServiceConfigs.serviceId, serviceId))
            .limit(1);

        return result[0] || null;
    }

    async updateTraefikConfig(serviceId: string, data: any) {
        this.logger.log(`Updating Traefik config for service: ${serviceId}`);

        const updateData: any = {
            updatedAt: new Date(),
            ...data,
        };

        // Update fullDomain if domain or subdomain changed
        if (data.domain !== undefined || data.subdomain !== undefined) {
            const existing = await this.getTraefikConfigByService(serviceId);
            if (existing) {
                const domain = data.domain ?? existing.domain;
                const subdomain = data.subdomain ?? existing.subdomain;
                updateData.fullDomain = subdomain ? `${subdomain}.${domain}` : domain;
            }
        }

        const [updated] = await this.databaseService.db
            .update(traefikServiceConfigs)
            .set(updateData)
            .where(eq(traefikServiceConfigs.serviceId, serviceId))
            .returning();

        return updated || null;
    }

    async syncTraefikConfig(serviceId: string) {
        this.logger.log(`Syncing Traefik config for service: ${serviceId}`);

        const syncedAt = new Date();

        await this.databaseService.db
            .update(traefikServiceConfigs)
            .set({
                lastSyncedAt: syncedAt,
                updatedAt: syncedAt,
            })
            .where(eq(traefikServiceConfigs.serviceId, serviceId));

        return syncedAt;
    }

    async removeDependencyById(dependencyId: string) {
        this.logger.log(`Removing dependency by ID: ${dependencyId}`);

        await this.databaseService.db
            .delete(serviceDependencies)
            .where(eq(serviceDependencies.id, dependencyId));

        return true;
    }
}
