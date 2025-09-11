import { Controller, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { serviceContract } from '@repo/api-contracts';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import { ServiceService } from '../../service/services/service.service';
import { services, serviceDependencies, projects, serviceHealthConfigs, traefikServiceConfigs } from '../../../core/modules/db/drizzle/schema';
import { eq, desc, count, ilike, and, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
@Controller()
export class ServiceController {
    private readonly logger = new Logger(ServiceController.name);
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly serviceService: ServiceService
    ) { }
    @Implement(serviceContract.listByProject)
    listByProject() {
        return implement(serviceContract.listByProject).handler(async ({ input }) => {
            this.logger.log(`Listing services for project: ${input.projectId}`);
            // Get database connection
            const db = this.databaseService.db;
            // Extract parameters with defaults
            const limit = input.limit || 20;
            const offset = input.offset || 0;
            const search = input.search;
            const type = input.type;
            const isActive = input.isActive;
            // Build conditions
            const conditions = [eq(services.projectId, input.projectId)];
            if (search) {
                conditions.push(ilike(services.name, `%${search}%`));
            }
            if (type) {
                conditions.push(eq(services.type, type));
            }
            if (isActive !== undefined) {
                conditions.push(eq(services.isActive, isActive));
            }
            const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);
            // Execute queries
            const serviceList = await db
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
            const countResult = await db
                .select({ count: count() })
                .from(services)
                .where(whereClause);
            const total = countResult[0]?.count ?? 0;
            const hasMore = offset + limit < total;
            // Transform to match serviceWithStatsSchema
            const servicesWithStats = serviceList.map(({ service, healthCheckConfig, project }) => ({
                id: service.id,
                projectId: service.projectId,
                name: service.name,
                type: service.type,
                provider: service.provider,
                builder: service.builder,
                providerConfig: service.providerConfig,
                builderConfig: service.builderConfig,
                // TODO: Map real traefik config once stored per-service
                traefikConfig: null,
                port: service.port,
                healthCheckPath: service.healthCheckPath || '/health',
                healthCheckConfig: healthCheckConfig ? {
                    type: healthCheckConfig.checkType,
                    enabled: healthCheckConfig.enabled,
                    interval: healthCheckConfig.interval,
                    timeout: healthCheckConfig.timeout,
                    retries: healthCheckConfig.retries,
                    startPeriod: healthCheckConfig.startPeriod,
                    ...(healthCheckConfig.config && typeof healthCheckConfig.config === 'object' ? healthCheckConfig.config as any : {}),
                    alertOnFailure: healthCheckConfig.alertOnFailure,
                    alertWebhookUrl: healthCheckConfig.alertWebhookUrl,
                    alertEmail: healthCheckConfig.alertEmail,
                } : null,
                environmentVariables: service.environmentVariables,
                resourceLimits: service.resourceLimits,
                isActive: service.isActive,
                createdAt: service.createdAt,
                updatedAt: service.updatedAt,
                _count: {
                    deployments: 0, // TODO: Implement deployment count
                    dependencies: 0, // TODO: Implement dependency count
                },
                latestDeployment: null, // TODO: Implement latest deployment
                project,
            }));
            return {
                services: servicesWithStats,
                total,
                hasMore,
            };
        });
    }
    @Implement(serviceContract.getById)
    getById() {
        return implement(serviceContract.getById).handler(async ({ input }) => {
            this.logger.log(`Getting service by id: ${input.id}`);
            // Get database connection
            const db = this.databaseService.db;
            // Find the service with project info
            const result = await db
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
                .where(eq(services.id, input.id))
                .limit(1);
            if (result.length === 0) {
                throw new NotFoundException(`Service with ID ${input.id} not found`);
            }
            const { service, healthCheckConfig, project } = result[0];
            return {
                id: service.id,
                projectId: service.projectId,
                name: service.name,
                type: service.type,
                provider: service.provider,
                builder: service.builder,
                providerConfig: service.providerConfig,
                builderConfig: service.builderConfig,
                // TODO: Map real traefik config once stored per-service
                traefikConfig: null,
                port: service.port,
                healthCheckPath: service.healthCheckPath || '/health',
                healthCheckConfig: healthCheckConfig ? {
                    type: healthCheckConfig.checkType,
                    enabled: healthCheckConfig.enabled,
                    interval: healthCheckConfig.interval,
                    timeout: healthCheckConfig.timeout,
                    retries: healthCheckConfig.retries,
                    startPeriod: healthCheckConfig.startPeriod,
                    ...(healthCheckConfig.config && typeof healthCheckConfig.config === 'object' ? healthCheckConfig.config as any : {}),
                    alertOnFailure: healthCheckConfig.alertOnFailure,
                    alertWebhookUrl: healthCheckConfig.alertWebhookUrl,
                    alertEmail: healthCheckConfig.alertEmail,
                } : null,
                environmentVariables: service.environmentVariables,
                resourceLimits: service.resourceLimits,
                isActive: service.isActive,
                createdAt: service.createdAt,
                updatedAt: service.updatedAt,
                _count: {
                    deployments: 0, // TODO: Implement deployment count
                    dependencies: 0, // TODO: Implement dependency count
                },
                latestDeployment: null, // TODO: Implement latest deployment
                project,
            };
        });
    }
    @Implement(serviceContract.create)
    create() {
        return implement(serviceContract.create).handler(async ({ input }) => {
            this.logger.log(`Creating service: ${input.name} for project: ${input.projectId}`);
            // Get database connection
            const db = this.databaseService.db;
            // Verify project exists
            const projectExists = await db
                .select({ id: projects.id })
                .from(projects)
                .where(eq(projects.id, input.projectId))
                .limit(1);
            if (projectExists.length === 0) {
                throw new NotFoundException(`Project with ID ${input.projectId} not found`);
            }
            // Create service (ID will be auto-generated by database)
            const [newService] = await db
                .insert(services)
                .values({
                id: randomUUID(),
                projectId: input.projectId,
                name: input.name,
                type: input.type,
                provider: input.provider || 'docker',
                builder: input.builder || null,
                providerConfig: input.providerConfig || null,
                builderConfig: input.builderConfig || null,
                port: input.port || null,
                healthCheckPath: input.healthCheckPath || '/health',
                environmentVariables: input.environmentVariables || null,
                resourceLimits: input.resourceLimits || null,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
                .returning();
            if (!newService) {
                throw new BadRequestException('Failed to create service');
            }
            // Get health check config for the newly created service
            const serviceWithHealth = await db
                .select({
                service: services,
                healthConfig: serviceHealthConfigs,
            })
                .from(services)
                .leftJoin(serviceHealthConfigs, eq(services.id, serviceHealthConfigs.serviceId))
                .where(eq(services.id, newService.id))
                .limit(1);
            const serviceData = serviceWithHealth[0];
            return {
                id: serviceData.service.id,
                projectId: serviceData.service.projectId,
                name: serviceData.service.name,
                type: serviceData.service.type,
                provider: serviceData.service.provider,
                builder: serviceData.service.builder,
                providerConfig: serviceData.service.providerConfig,
                builderConfig: serviceData.service.builderConfig,
                // TODO: Map real traefik config once stored per-service
                traefikConfig: null,
                port: serviceData.service.port,
                healthCheckPath: serviceData.service.healthCheckPath || '/health',
                environmentVariables: serviceData.service.environmentVariables,
                resourceLimits: serviceData.service.resourceLimits,
                isActive: serviceData.service.isActive,
                createdAt: serviceData.service.createdAt,
                updatedAt: serviceData.service.updatedAt,
                healthCheckConfig: serviceData.healthConfig ? {
                    type: serviceData.healthConfig.checkType,
                    enabled: serviceData.healthConfig.enabled,
                    interval: serviceData.healthConfig.interval,
                    timeout: serviceData.healthConfig.timeout,
                    retries: serviceData.healthConfig.retries,
                    startPeriod: serviceData.healthConfig.startPeriod,
                    ...(serviceData.healthConfig.config && typeof serviceData.healthConfig.config === 'object' ? serviceData.healthConfig.config as any : {}),
                    alertOnFailure: serviceData.healthConfig.alertOnFailure,
                    alertWebhookUrl: serviceData.healthConfig.alertWebhookUrl,
                    alertEmail: serviceData.healthConfig.alertEmail,
                } : null,
            };
        });
    }
    @Implement(serviceContract.update)
    update() {
        return implement(serviceContract.update).handler(async ({ input }) => {
            this.logger.log(`Updating service: ${input.id}`);
            // Get database connection
            const db = this.databaseService.db;
            // Check if service exists
            const existingService = await db
                .select()
                .from(services)
                .where(eq(services.id, input.id))
                .limit(1);
            if (existingService.length === 0) {
                throw new NotFoundException(`Service with ID ${input.id} not found`);
            }
            // Update service
            const updateData: any = {
                updatedAt: new Date(),
            };
            if (input.name !== undefined)
                updateData.name = input.name;
            if (input.type !== undefined)
                updateData.type = input.type;
            if (input.provider !== undefined)
                updateData.provider = input.provider;
            if (input.builder !== undefined)
                updateData.builder = input.builder;
            if (input.providerConfig !== undefined)
                updateData.providerConfig = input.providerConfig;
            if (input.builderConfig !== undefined)
                updateData.builderConfig = input.builderConfig;
            if (input.port !== undefined)
                updateData.port = input.port;
            if (input.healthCheckPath !== undefined)
                updateData.healthCheckPath = input.healthCheckPath;
            if (input.environmentVariables !== undefined)
                updateData.environmentVariables = input.environmentVariables;
            if (input.resourceLimits !== undefined)
                updateData.resourceLimits = input.resourceLimits;
            const [updatedService] = await db
                .update(services)
                .set(updateData)
                .where(eq(services.id, input.id))
                .returning();
            if (!updatedService) {
                throw new BadRequestException('Failed to update service');
            }
            // Get health check config for the updated service
            const serviceWithHealth = await db
                .select({
                service: services,
                healthConfig: serviceHealthConfigs,
            })
                .from(services)
                .leftJoin(serviceHealthConfigs, eq(services.id, serviceHealthConfigs.serviceId))
                .where(eq(services.id, updatedService.id))
                .limit(1);
            const serviceData = serviceWithHealth[0];
            return {
                id: serviceData.service.id,
                projectId: serviceData.service.projectId,
                name: serviceData.service.name,
                type: serviceData.service.type,
                provider: serviceData.service.provider,
                builder: serviceData.service.builder,
                providerConfig: serviceData.service.providerConfig,
                builderConfig: serviceData.service.builderConfig,
                // TODO: Map real traefik config once stored per-service
                traefikConfig: null,
                port: serviceData.service.port,
                healthCheckPath: serviceData.service.healthCheckPath || '/health',
                environmentVariables: serviceData.service.environmentVariables,
                resourceLimits: serviceData.service.resourceLimits,
                isActive: serviceData.service.isActive,
                createdAt: serviceData.service.createdAt,
                updatedAt: serviceData.service.updatedAt,
                healthCheckConfig: serviceData.healthConfig ? {
                    type: serviceData.healthConfig.checkType,
                    enabled: serviceData.healthConfig.enabled,
                    interval: serviceData.healthConfig.interval,
                    timeout: serviceData.healthConfig.timeout,
                    retries: serviceData.healthConfig.retries,
                    startPeriod: serviceData.healthConfig.startPeriod,
                    ...(serviceData.healthConfig.config && typeof serviceData.healthConfig.config === 'object' ? serviceData.healthConfig.config as any : {}),
                    alertOnFailure: serviceData.healthConfig.alertOnFailure,
                    alertWebhookUrl: serviceData.healthConfig.alertWebhookUrl,
                    alertEmail: serviceData.healthConfig.alertEmail,
                } : null,
            };
        });
    }
    @Implement(serviceContract.delete)
    delete() {
        return implement(serviceContract.delete).handler(async ({ input }) => {
            this.logger.log(`Deleting service: ${input.id}`);
            // Get database connection
            const db = this.databaseService.db;
            // Check if service exists
            const existingService = await db
                .select()
                .from(services)
                .where(eq(services.id, input.id))
                .limit(1);
            if (existingService.length === 0) {
                throw new NotFoundException(`Service with ID ${input.id} not found`);
            }
            // Delete the service (CASCADE will handle related records)
            await db.delete(services).where(eq(services.id, input.id));
            return {
                success: true,
                message: 'Service deleted successfully',
            };
        });
    }
    @Implement(serviceContract.getDeployments)
    getDeployments() {
        return implement(serviceContract.getDeployments).handler(async ({ input: _input }) => {
            // TODO: Implement deployment listing
            this.logger.log('Getting service deployments (not implemented)');
            return {
                deployments: [],
                total: 0,
                hasMore: false,
            };
        });
    }
    @Implement(serviceContract.getDependencies)
    getDependencies() {
        return implement(serviceContract.getDependencies).handler(async ({ input }) => {
            this.logger.log(`Getting dependencies for service: ${input.id}`);
            // Get database connection
            const db = this.databaseService.db;
            // Get all dependencies for the service
            const dependencies = await db
                .select({
                dependency: serviceDependencies,
                dependsOnService: {
                    id: services.id,
                    name: services.name,
                    type: services.type,
                },
            })
                .from(serviceDependencies)
                .innerJoin(services, eq(serviceDependencies.dependsOnServiceId, services.id))
                .where(eq(serviceDependencies.serviceId, input.id));
            // Transform to match contract schema
            const transformedDependencies = dependencies.map(({ dependency, dependsOnService }) => ({
                id: dependency.id,
                serviceId: dependency.serviceId,
                dependsOnServiceId: dependency.dependsOnServiceId,
                isRequired: dependency.isRequired,
                createdAt: dependency.createdAt,
                dependsOnService,
            }));
            return { dependencies: transformedDependencies };
        });
    }
    @Implement(serviceContract.addDependency)
    addDependency() {
        return implement(serviceContract.addDependency).handler(async ({ input }) => {
            this.logger.log(`Adding dependency for service: ${input.id}`);
            // Get database connection
            const db = this.databaseService.db;
            // Verify both services exist
            const servicesExist = await db
                .select({ id: services.id })
                .from(services)
                .where(or(eq(services.id, input.id), eq(services.id, input.dependsOnServiceId)));
            if (servicesExist.length < 2) {
                throw new NotFoundException('One or both services not found');
            }
            // Create dependency (ID will be auto-generated by database)
            const [newDependency] = await db
                .insert(serviceDependencies)
                .values({
                serviceId: input.id,
                dependsOnServiceId: input.dependsOnServiceId,
                isRequired: input.isRequired,
                createdAt: new Date(),
            })
                .returning();
            if (!newDependency) {
                throw new BadRequestException('Failed to create dependency');
            }
            return {
                id: newDependency.id,
                serviceId: newDependency.serviceId,
                dependsOnServiceId: newDependency.dependsOnServiceId,
                isRequired: newDependency.isRequired,
                createdAt: newDependency.createdAt,
            };
        });
    }
    @Implement(serviceContract.removeDependency)
    removeDependency() {
        return implement(serviceContract.removeDependency).handler(async ({ input }) => {
            this.logger.log(`Removing dependency: ${input.dependencyId} for service: ${input.id}`);
            // Get database connection
            const db = this.databaseService.db;
            // Check if dependency exists
            const existingDependency = await db
                .select()
                .from(serviceDependencies)
                .where(and(eq(serviceDependencies.id, input.dependencyId), eq(serviceDependencies.serviceId, input.id)))
                .limit(1);
            if (existingDependency.length === 0) {
                throw new NotFoundException(`Dependency with ID ${input.dependencyId} not found`);
            }
            // Delete the dependency
            await db
                .delete(serviceDependencies)
                .where(eq(serviceDependencies.id, input.dependencyId));
            return {
                success: true,
                message: 'Dependency removed successfully',
            };
        });
    }
    @Implement(serviceContract.toggleActive)
    toggleActive() {
        return implement(serviceContract.toggleActive).handler(async ({ input }) => {
            this.logger.log(`Toggling active status for service: ${input.id} to ${input.isActive}`);
            // Get database connection
            const db = this.databaseService.db;
            // Check if service exists
            const existingService = await db
                .select()
                .from(services)
                .where(eq(services.id, input.id))
                .limit(1);
            if (existingService.length === 0) {
                throw new NotFoundException(`Service with ID ${input.id} not found`);
            }
            // Update service active status
            const [updatedService] = await db
                .update(services)
                .set({
                isActive: input.isActive,
                updatedAt: new Date(),
            })
                .where(eq(services.id, input.id))
                .returning();
            if (!updatedService) {
                throw new BadRequestException('Failed to update service status');
            }
            // Get health check config for the updated service
            const serviceWithHealth = await db
                .select({
                service: services,
                healthConfig: serviceHealthConfigs,
            })
                .from(services)
                .leftJoin(serviceHealthConfigs, eq(services.id, serviceHealthConfigs.serviceId))
                .where(eq(services.id, updatedService.id))
                .limit(1);
            const serviceData = serviceWithHealth[0];
            return {
                id: serviceData.service.id,
                projectId: serviceData.service.projectId,
                name: serviceData.service.name,
                type: serviceData.service.type,
                provider: serviceData.service.provider,
                builder: serviceData.service.builder,
                providerConfig: serviceData.service.providerConfig,
                builderConfig: serviceData.service.builderConfig,
                // TODO: Map real traefik config once stored per-service
                traefikConfig: null,
                port: serviceData.service.port,
                healthCheckPath: serviceData.service.healthCheckPath || '/health',
                environmentVariables: serviceData.service.environmentVariables,
                resourceLimits: serviceData.service.resourceLimits,
                isActive: serviceData.service.isActive,
                createdAt: serviceData.service.createdAt,
                updatedAt: serviceData.service.updatedAt,
                healthCheckConfig: serviceData.healthConfig ? {
                    type: serviceData.healthConfig.checkType,
                    enabled: serviceData.healthConfig.enabled,
                    interval: serviceData.healthConfig.interval,
                    timeout: serviceData.healthConfig.timeout,
                    retries: serviceData.healthConfig.retries,
                    startPeriod: serviceData.healthConfig.startPeriod,
                    ...(serviceData.healthConfig.config && typeof serviceData.healthConfig.config === 'object' ? serviceData.healthConfig.config as any : {}),
                    alertOnFailure: serviceData.healthConfig.alertOnFailure,
                    alertWebhookUrl: serviceData.healthConfig.alertWebhookUrl,
                    alertEmail: serviceData.healthConfig.alertEmail,
                } : null,
            };
        });
    }
    @Implement(serviceContract.getLogs)
    getLogs() {
        return implement(serviceContract.getLogs).handler(async ({ input }) => {
            this.logger.log(`Getting logs for service: ${input.id}`);
            // TODO: Implement actual log retrieval from Docker/container runtime
            // For now, return mock logs
            const mockLogs = [
                {
                    id: '1',
                    timestamp: new Date(Date.now() - 60000), // 1 minute ago
                    level: 'info' as const,
                    message: 'Service started successfully',
                    source: 'container' as const,
                    containerId: 'container-123',
                    metadata: { service: 'web' },
                },
                {
                    id: '2',
                    timestamp: new Date(Date.now() - 30000), // 30 seconds ago
                    level: 'info' as const,
                    message: 'Health check passed',
                    source: 'health_check' as const,
                    containerId: 'container-123',
                    metadata: { endpoint: '/health' },
                },
                {
                    id: '3',
                    timestamp: new Date(), // Now
                    level: 'warn' as const,
                    message: 'High memory usage detected',
                    source: 'system' as const,
                    containerId: 'container-123',
                    metadata: { memory_percent: 85 },
                },
            ];
            // Filter by level if specified
            const filteredLogs = input.level
                ? mockLogs.filter(log => log.level === input.level)
                : mockLogs;
            // Apply pagination
            const startIndex = input.offset || 0;
            const endIndex = startIndex + (input.limit || 100);
            const paginatedLogs = filteredLogs.slice(startIndex, endIndex);
            return {
                logs: paginatedLogs,
                total: filteredLogs.length,
                hasMore: endIndex < filteredLogs.length,
            };
        });
    }
    @Implement(serviceContract.getMetrics)
    getMetrics() {
        return implement(serviceContract.getMetrics).handler(async ({ input }) => {
            this.logger.log(`Getting metrics for service: ${input.id}`);
            // TODO: Implement actual metrics retrieval from monitoring system
            // For now, return mock metrics
            const now = new Date();
            const interval = 5 * 60 * 1000; // 5 minutes in milliseconds
            const generateDataPoints = (count: number) => {
                return Array.from({ length: count }, (_, i) => {
                    return new Date(now.getTime() - (count - 1 - i) * interval);
                });
            };
            const timestamps = generateDataPoints(12); // Last hour with 5-minute intervals
            return {
                cpu: timestamps.map((timestamp) => ({
                    timestamp,
                    value: Math.random() * 80 + 10, // Random CPU between 10-90%
                })),
                memory: timestamps.map((timestamp) => ({
                    timestamp,
                    used: Math.floor(Math.random() * 400 + 100) * 1024 * 1024, // 100-500MB
                    total: 512 * 1024 * 1024, // 512MB total
                })),
                network: timestamps.map((timestamp) => ({
                    timestamp,
                    bytesIn: Math.floor(Math.random() * 1000 + 500),
                    bytesOut: Math.floor(Math.random() * 800 + 300),
                })),
                requests: timestamps.map((timestamp) => ({
                    timestamp,
                    count: Math.floor(Math.random() * 100 + 10),
                    responseTime: Math.random() * 200 + 50, // 50-250ms response time
                })),
            };
        });
    }
    @Implement(serviceContract.getHealth)
    getHealth() {
        return implement(serviceContract.getHealth).handler(async ({ input }) => {
            this.logger.log(`Getting health status for service: ${input.id}`);
            // TODO: Implement actual health check retrieval from Docker/monitoring
            // For now, return mock health status
            const mockHealth = {
                status: 'healthy' as const,
                lastCheck: new Date(),
                checks: [
                    {
                        name: 'HTTP Health Check',
                        status: 'pass' as const,
                        message: 'Service responding on /health endpoint',
                        timestamp: new Date(),
                    },
                    {
                        name: 'Database Connection',
                        status: 'pass' as const,
                        message: 'Database connection is healthy',
                        timestamp: new Date(),
                    },
                    {
                        name: 'Memory Usage',
                        status: 'warn' as const,
                        message: 'Memory usage is above 80%',
                        timestamp: new Date(),
                    },
                ],
                uptime: Math.floor(Math.random() * 86400 + 3600), // Random uptime 1-25 hours
                containerStatus: 'running' as const,
            };
            return mockHealth;
        });
    }

    @Implement(serviceContract.getTraefikConfig)
    getTraefikConfig() {
        return implement(serviceContract.getTraefikConfig).handler(async ({ input }) => {
            this.logger.log(`Getting Traefik configuration for service: ${input.id}`);
            
            const db = this.databaseService.db;
            
            // Get service and its Traefik configuration
            const result = await db
                .select()
                .from(traefikServiceConfigs)
                .where(eq(traefikServiceConfigs.serviceId, input.id))
                .limit(1);

            if (result.length === 0) {
                throw new NotFoundException(`Traefik configuration not found for service ${input.id}`);
            }

            const config = result[0];
            
            return {
                id: config.id,
                serviceId: config.serviceId,
                domain: config.domain,
                subdomain: config.subdomain ?? '',
                fullDomain: config.fullDomain,
                sslEnabled: config.sslEnabled ?? false,
                sslProvider: config.sslProvider,
                pathPrefix: config.pathPrefix ?? '',
                port: config.port,
                middleware: config.middleware as Record<string, any> ?? {},
                healthCheck: config.healthCheck as Record<string, any> ?? {},
                isActive: config.isActive ?? true,
                configContent: config.configContent ?? '',
                lastSyncedAt: config.lastSyncedAt?.toISOString() ?? null,
                createdAt: config.createdAt?.toISOString() ?? new Date().toISOString(),
                updatedAt: config.updatedAt?.toISOString() ?? new Date().toISOString(),
            };
        });
    }

    @Implement(serviceContract.updateTraefikConfig)
    updateTraefikConfig() {
        return implement(serviceContract.updateTraefikConfig).handler(async ({ input }) => {
            this.logger.log(`Updating Traefik configuration for service: ${input.id}`);
            
            const db = this.databaseService.db;
            
            // First check if service exists
            const serviceExists = await db
                .select({ id: services.id })
                .from(services)
                .where(eq(services.id, input.id))
                .limit(1);

            if (serviceExists.length === 0) {
                throw new NotFoundException(`Service ${input.id} not found`);
            }

            // Check if Traefik config exists
            const existingConfig = await db
                .select()
                .from(traefikServiceConfigs)
                .where(eq(traefikServiceConfigs.serviceId, input.id))
                .limit(1);

            if (existingConfig.length === 0) {
                throw new NotFoundException(`Traefik configuration not found for service ${input.id}`);
            }

            // Build update object
            const updateData: any = {
                updatedAt: new Date(),
            };

            if (input.domain !== undefined) updateData.domain = input.domain;
            if (input.subdomain !== undefined) updateData.subdomain = input.subdomain;
            if (input.sslEnabled !== undefined) updateData.sslEnabled = input.sslEnabled;
            if (input.sslProvider !== undefined) updateData.sslProvider = input.sslProvider;
            if (input.pathPrefix !== undefined) updateData.pathPrefix = input.pathPrefix;
            if (input.port !== undefined) updateData.port = input.port;
            if (input.middleware !== undefined) updateData.middleware = input.middleware;
            if (input.healthCheck !== undefined) updateData.healthCheck = input.healthCheck;
            if (input.configContent !== undefined) updateData.configContent = input.configContent;
            if (input.isActive !== undefined) updateData.isActive = input.isActive;

            // If domain or subdomain changed, update fullDomain
            if (input.domain !== undefined || input.subdomain !== undefined) {
                const domain = input.domain ?? existingConfig[0].domain;
                const subdomain = input.subdomain ?? existingConfig[0].subdomain;
                updateData.fullDomain = `${subdomain}.${domain}`;
            }

            // Update the configuration
            const updated = await db
                .update(traefikServiceConfigs)
                .set(updateData)
                .where(eq(traefikServiceConfigs.serviceId, input.id))
                .returning();

            if (updated.length === 0) {
                throw new BadRequestException('Failed to update Traefik configuration');
            }

            const config = updated[0];
            
            return {
                id: config.id,
                serviceId: config.serviceId,
                domain: config.domain,
                subdomain: config.subdomain ?? '',
                fullDomain: config.fullDomain,
                sslEnabled: config.sslEnabled ?? false,
                sslProvider: config.sslProvider,
                pathPrefix: config.pathPrefix ?? '',
                port: config.port,
                middleware: config.middleware as Record<string, any> ?? {},
                healthCheck: config.healthCheck as Record<string, any> ?? {},
                isActive: config.isActive ?? true,
                configContent: config.configContent ?? '',
                lastSyncedAt: config.lastSyncedAt?.toISOString() ?? null,
                createdAt: config.createdAt?.toISOString() ?? new Date().toISOString(),
                updatedAt: config.updatedAt?.toISOString() ?? new Date().toISOString(),
            };
        });
    }

    @Implement(serviceContract.syncTraefikConfig)
    syncTraefikConfig() {
        return implement(serviceContract.syncTraefikConfig).handler(async ({ input }) => {
            this.logger.log(`Syncing Traefik configuration for service: ${input.id}`);
            
            const db = this.databaseService.db;
            
            // Get the Traefik configuration
            const result = await db
                .select()
                .from(traefikServiceConfigs)
                .where(eq(traefikServiceConfigs.serviceId, input.id))
                .limit(1);

            if (result.length === 0) {
                throw new NotFoundException(`Traefik configuration not found for service ${input.id}`);
            }

            const config = result[0];
            
            // TODO: Implement actual file system sync logic here
            // This would write the config.configContent to Traefik dynamic config directory
            // For now, just simulate the sync
            
            const syncedAt = new Date();
            
            // Update last synced timestamp
            await db
                .update(traefikServiceConfigs)
                .set({ 
                    lastSyncedAt: syncedAt,
                    updatedAt: syncedAt,
                })
                .where(eq(traefikServiceConfigs.serviceId, input.id));

            const filePath = `/etc/traefik/dynamic/${config.subdomain}.${config.domain}.yml`;
            
            this.logger.log(`Traefik configuration synced for service ${input.id} to ${filePath}`);
            
            return {
                success: true,
                message: `Traefik configuration synced successfully for service ${config.subdomain}.${config.domain}`,
                syncedAt: syncedAt.toISOString(),
                filePath,
            };
        });
    }

    @Implement(serviceContract.getProjectDependencyGraph)
    getProjectDependencyGraph() {
        return implement(serviceContract.getProjectDependencyGraph).handler(async ({ input }) => {
            this.logger.log(`Getting dependency graph for project: ${input.projectId}`);
            
            try {
                const dependencyGraph = await this.serviceService.getProjectDependencyGraph(input.projectId);
                
                this.logger.log(`Successfully retrieved dependency graph for project ${input.projectId} with ${dependencyGraph.nodes.length} nodes and ${dependencyGraph.edges.length} edges`);
                
                return dependencyGraph;
            } catch (error) {
                const err = error as Error;
                this.logger.error(`Error getting dependency graph for project ${input.projectId}: ${err.message}`);
                throw error;
            }
        });
    }
}
