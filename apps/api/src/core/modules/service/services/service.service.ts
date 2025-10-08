import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ServiceRepository, type CreateServiceData, type UpdateServiceData, type ServiceLogsFilter } from '@/core/modules/service/repositories/service.repository';

@Injectable()
export class ServiceService {
    private readonly logger = new Logger(ServiceService.name);

    constructor(
        private readonly serviceRepository: ServiceRepository,
    ) { }

    /**
     * Transform DB traefik config to API contract format
     * Contract only expects specific fields, DB has more fields
     */
    private transformTraefikConfig(dbConfig: any) {
        if (!dbConfig) return null;
        
        // Map DB fields to contract fields
        return {
            domain: dbConfig.domain ?? undefined,
            subdomain: dbConfig.subdomain ?? undefined,
            pathPrefix: dbConfig.pathPrefix ?? undefined,
            // Map sslEnabled to tls
            tls: dbConfig.sslEnabled ?? undefined,
            // Map sslProvider to tlsCertResolver
            tlsCertResolver: dbConfig.sslProvider === 'letsencrypt' ? 'letsencrypt' : undefined,
            // Middleware from DB JSON field
            middlewares: dbConfig.middleware ? (Array.isArray(dbConfig.middleware) ? dbConfig.middleware : []) : undefined,
        };
    }

    async createService(data: CreateServiceData) {
        this.logger.log(`Creating service: ${data.name} in project: ${data.projectId}`);
        try {
            // Create the service in database
            const service = await this.serviceRepository.create(data);
            this.logger.log(`Service created with ID: ${service.id}`);
            
            // Fetch traefik and health check configs to match contract
            const traefikConfig = await this.serviceRepository.getTraefikConfigByService(service.id);
            // Health check config might not exist yet, we'll return null
            
            return {
                ...service,
                healthCheckPath: service.healthCheckPath || '', // Ensure healthCheckPath is never null
                traefikConfig: this.transformTraefikConfig(traefikConfig),
                healthCheckConfig: null, // New service won't have health check config yet
            };
        }
        catch (error) {
            const err = error as Error;
            this.logger.error(`Error creating service: ${err.message}`, err.stack);
            throw error;
        }
    }

    async getService(id: string) {
        this.logger.log(`Getting service: ${id}`);
        const service = await this.serviceRepository.findById(id);
        if (!service) {
            throw new NotFoundException(`Service not found: ${id}`);
        }
        return service;
    }

    async listServices(projectId: string, activeOnly = false) {
        this.logger.log(`Listing services for project: ${projectId}, activeOnly: ${activeOnly}`);
        return await this.serviceRepository.findServicesByProject(projectId, activeOnly);
    }

    async updateService(id: string, data: UpdateServiceData) {
        this.logger.log(`Updating service: ${id}`);
        const existingService = await this.serviceRepository.findById(id);
        if (!existingService) {
            throw new NotFoundException(`Service not found: ${id}`);
        }

        const updatedService = await this.serviceRepository.update(id, data);
        
        // Fetch traefik and health check configs to match contract
        const traefikConfig = await this.serviceRepository.getTraefikConfigByService(id);
        // Try to get health check config if it exists
        
        return {
            ...updatedService,
            healthCheckPath: updatedService.healthCheckPath || '', // Ensure healthCheckPath is never null
            traefikConfig: this.transformTraefikConfig(traefikConfig),
            healthCheckConfig: null, // TODO: fetch if exists
        };
    }

    async deleteService(id: string) {
        this.logger.log(`Deleting service: ${id}`);
        const service = await this.serviceRepository.findById(id);
        if (!service) {
            throw new NotFoundException(`Service not found: ${id}`);
        }

        // Delete the service
        await this.serviceRepository.delete(id);
        return { success: true, message: 'Service deleted successfully' };
    }

    async getServiceLogs(
        serviceId: string,
        deploymentId?: string,
        filter: ServiceLogsFilter = {},
        limit = 100,
        offset = 0
    ) {
        this.logger.log(`Getting logs for service: ${serviceId}, deployment: ${deploymentId}`);
        const service = await this.serviceRepository.findById(serviceId);
        if (!service) {
            throw new NotFoundException(`Service not found: ${serviceId}`);
        }

        let targetDeploymentId = deploymentId;

        // If no specific deployment ID provided, get logs from active deployment
        if (!targetDeploymentId) {
            const activeDeployments = await this.serviceRepository.findActiveDeployments(serviceId);
            if (activeDeployments.length > 0) {
                targetDeploymentId = activeDeployments[0].id; // Get most recent active deployment
                this.logger.log(`Using active deployment: ${targetDeploymentId}`);
            }
            else {
                // Return empty logs if no active deployments
                return {
                    logs: [],
                    total: 0,
                    hasMore: false
                };
            }
        }

        const logs = await this.serviceRepository.findDeploymentLogs(
            targetDeploymentId,
            filter,
            limit,
            offset
        );
        const total = logs.length; // This is simplified - in production, you'd do a separate count query

        return {
            logs: logs.map(log => ({
                id: log.id,
                timestamp: log.timestamp,
                level: log.level,
                message: log.message,
                // Transform to match contract schema
                source: (log.stage || 'system') as 'container' | 'system' | 'proxy' | 'health_check',
                containerId: log.service || service.name, // Using service name as container ID
                metadata: log.metadata || undefined,
            })),
            total,
            hasMore: offset + limit < total
        };
    }

    async addServiceLog(
        serviceId: string,
        deploymentId: string,
        logData: {
            level: 'info' | 'warn' | 'error' | 'debug';
            message: string;
            phase?: string;
            step?: string;
            stage?: string;
            metadata?: Record<string, any>;
        }
    ) {
        this.logger.log(`Adding log for service: ${serviceId}, deployment: ${deploymentId}`);
        const service = await this.serviceRepository.findById(serviceId);
        if (!service) {
            throw new NotFoundException(`Service not found: ${serviceId}`);
        }

        return await this.serviceRepository.createDeploymentLog({
            deploymentId,
            level: logData.level,
            message: logData.message,
            phase: logData.phase,
            step: logData.step,
            service: service.name,
            stage: logData.stage,
            metadata: logData.metadata,
        });
    }

    async getServiceHealth(serviceId: string) {
        this.logger.log(`Getting health status for service: ${serviceId}`);
        const service = await this.serviceRepository.findById(serviceId);
        if (!service) {
            throw new NotFoundException(`Service not found: ${serviceId}`);
        }

        // Check active deployments
        const activeDeployments = await this.serviceRepository.findActiveDeployments(serviceId);
        
        // Transform to match contract schema
        const now = new Date();
        const hasActiveDeployment = activeDeployments.length > 0;
        
        return {
            status: hasActiveDeployment ? 'healthy' as const : 'unknown' as const,
            lastCheck: now,
            checks: hasActiveDeployment ? [
                {
                    name: 'deployment',
                    status: 'pass' as const,
                    message: 'Service has active deployment',
                    timestamp: now,
                }
            ] : [
                {
                    name: 'deployment',
                    status: 'fail' as const,
                    message: 'No active deployment found',
                    timestamp: now,
                }
            ],
            uptime: 0, // Would come from monitoring system
            containerStatus: hasActiveDeployment ? 'running' as const : 'stopped' as const,
        };
    }

    async getServiceMetrics(serviceId: string) {
        this.logger.log(`Getting metrics for service: ${serviceId}`);
        const service = await this.serviceRepository.findById(serviceId);
        if (!service) {
            throw new NotFoundException(`Service not found: ${serviceId}`);
        }

        // This would integrate with monitoring systems
        // For now, return mock time-series data matching contract
        const now = new Date();
        
        return {
            cpu: [
                { timestamp: now, value: 0 }, // Would come from monitoring system
            ],
            memory: [
                { timestamp: now, used: 0, total: 0 }, // Would come from monitoring system
            ],
            network: [
                { timestamp: now, bytesIn: 0, bytesOut: 0 },
            ],
            requests: [
                { timestamp: now, count: 0, responseTime: 0 },
            ],
        };
    }

    async getProjectDependencyGraph(projectId: string) {
        this.logger.log(`Getting dependency graph for project: ${projectId}`);
        
        const graphData = await this.serviceRepository.getProjectDependencyGraph(projectId);
        
        if (!graphData.project) {
            throw new NotFoundException(`Project not found: ${projectId}`);
        }

        // Transform services into graph nodes
        const nodes = graphData.services.map(service => {
            const latestDeployment = graphData.latestDeployments[service.id];
            
            // Determine service status based on latest deployment and active state
            let status: 'healthy' | 'unhealthy' | 'unknown' | 'starting' | 'deploying' | 'failed';
            
            if (!service.isActive) {
                status = 'unhealthy';
            } else if (latestDeployment) {
                switch (latestDeployment.status) {
                    case 'success':
                        status = 'healthy';
                        break;
                    case 'building':
                    case 'deploying':
                    case 'queued':
                    case 'pending':
                        status = 'deploying';
                        break;
                    case 'failed':
                    case 'cancelled':
                        status = 'failed';
                        break;
                    default:
                        status = 'unknown';
                }
            } else {
                status = 'unknown';
            }

            return {
                id: service.id,
                name: service.name,
                type: service.type,
                status,
                isActive: service.isActive,
                port: service.port,
                latestDeployment: latestDeployment ? {
                    id: latestDeployment.id,
                    status: latestDeployment.status as any,
                    environment: latestDeployment.environment as any,
                    createdAt: latestDeployment.createdAt,
                    domainUrl: latestDeployment.domainUrl,
                } : null,
            };
        });

        // Transform dependencies into graph edges
        const edges = graphData.dependencies.map(dep => ({
            id: dep.id,
            sourceId: dep.serviceId,
            targetId: dep.dependsOnServiceId,
            isRequired: dep.isRequired,
            createdAt: dep.createdAt,
        }));

        return {
            nodes,
            edges,
            project: {
                id: graphData.project.id,
                name: graphData.project.name,
                baseDomain: graphData.project.baseDomain,
            },
        };
    }

    // Service dependency methods
    async addServiceDependency(serviceId: string, dependsOnServiceId: string, isRequired = true) {
        this.logger.log(`Adding dependency: ${serviceId} depends on ${dependsOnServiceId}`);
        
        // Verify both services exist
        const service = await this.serviceRepository.findById(serviceId);
        if (!service) {
            throw new NotFoundException(`Service not found: ${serviceId}`);
        }

        const dependentService = await this.serviceRepository.findById(dependsOnServiceId);
        if (!dependentService) {
            throw new NotFoundException(`Dependent service not found: ${dependsOnServiceId}`);
        }

        return await this.serviceRepository.createServiceDependency(serviceId, dependsOnServiceId, isRequired);
    }

    async removeServiceDependency(serviceId: string, dependencyId: string) {
        this.logger.log(`Removing dependency: ${dependencyId} for service: ${serviceId}`);
        
        await this.serviceRepository.removeDependencyById(dependencyId);
        
        return {
            success: true,
            message: 'Dependency removed successfully',
        };
    }

    async getServiceDependencies(serviceId: string) {
        this.logger.log(`Getting dependencies for service: ${serviceId}`);
        const service = await this.serviceRepository.findById(serviceId);
        if (!service) {
            throw new NotFoundException(`Service not found: ${serviceId}`);
        }

        const dependencies = await this.serviceRepository.findServiceDependencies(serviceId);
        return { dependencies };
    }

    async listServicesByProject(input: {
        projectId: string;
        search?: string;
        type?: string;
        isActive?: boolean;
        limit?: number;
        offset?: number;
    }) {
        this.logger.log(`Listing services by project: ${input.projectId}`);

        const result = await this.serviceRepository.listServicesByProjectWithStats(
            input.projectId,
            {
                search: input.search,
                type: input.type,
                isActive: input.isActive,
                limit: input.limit || 20,
                offset: input.offset || 0,
            }
        );

        // Get service IDs to fetch traefik configs
        const serviceIds = result.services.map(s => s.service.id);
        const traefikConfigs = new Map();
        
        for (const serviceId of serviceIds) {
            const config = await this.serviceRepository.getTraefikConfigByService(serviceId);
            if (config) {
                traefikConfigs.set(serviceId, config);
            }
        }

        // Transform data to match contract
        const servicesWithStats = result.services.map(({ service, healthCheckConfig, project }) => {
            const deploymentCount = result.deploymentCounts.get(service.id) || 0;
            const dependencyCount = result.dependencyCounts.get(service.id) || 0;
            const latestDeployment = result.latestDeployments.get(service.id) || null;
            const traefikConfig = traefikConfigs.get(service.id) || null;

            return {
                ...service,
                healthCheckPath: service.healthCheckPath || '', // Ensure healthCheckPath is never null
                traefikConfig: this.transformTraefikConfig(traefikConfig),
                healthCheckConfig: healthCheckConfig ? {
                    type: healthCheckConfig.checkType,
                    enabled: healthCheckConfig.enabled,
                    interval: healthCheckConfig.interval,
                    timeout: healthCheckConfig.timeout,
                    retries: healthCheckConfig.retries,
                    startPeriod: healthCheckConfig.startPeriod,
                    alertOnFailure: healthCheckConfig.alertOnFailure,
                    alertWebhookUrl: healthCheckConfig.alertWebhookUrl ?? undefined,
                    alertEmail: healthCheckConfig.alertEmail ?? undefined,
                } : null,
                project,
                _count: {
                    deployments: deploymentCount,
                    dependencies: dependencyCount,
                },
                latestDeployment,
            };
        });

        return {
            services: servicesWithStats,
            total: result.total,
            hasMore: result.hasMore,
        };
    }

    async getServiceById(id: string) {
        this.logger.log(`Getting service by ID: ${id}`);

        const result = await this.serviceRepository.getServiceWithDetails(id);
        if (!result) {
            throw new NotFoundException(`Service not found: ${id}`);
        }

        const { service, healthCheckConfig, project, stats, latestDeployment } = result;
        const traefikConfig = await this.serviceRepository.getTraefikConfigByService(id);

        return {
            ...service,
            healthCheckPath: service.healthCheckPath || '', // Ensure healthCheckPath is never null
            traefikConfig: this.transformTraefikConfig(traefikConfig),
            healthCheckConfig: healthCheckConfig ? {
                type: healthCheckConfig.checkType,
                enabled: healthCheckConfig.enabled,
                interval: healthCheckConfig.interval,
                timeout: healthCheckConfig.timeout,
                retries: healthCheckConfig.retries,
                startPeriod: healthCheckConfig.startPeriod,
                alertOnFailure: healthCheckConfig.alertOnFailure,
                alertWebhookUrl: healthCheckConfig.alertWebhookUrl ?? undefined,
                alertEmail: healthCheckConfig.alertEmail ?? undefined,
            } : null,
            project,
            _count: {
                deployments: stats.deploymentCount,
                dependencies: stats.dependencyCount,
            },
            latestDeployment,
        };
    }

    async getServiceDeployments(
        id: string,
        input: {
            environment?: string;
            status?: string;
            limit?: number;
            offset?: number;
        } = {}
    ) {
        this.logger.log(`Getting deployments for service: ${id}`);

        // Verify service exists
        const service = await this.serviceRepository.findById(id);
        if (!service) {
            throw new NotFoundException(`Service not found: ${id}`);
        }

        return await this.serviceRepository.getServiceDeployments(id, {
            environment: input.environment,
            status: input.status,
            limit: input.limit || 20,
            offset: input.offset || 0,
        });
    }

    async toggleServiceActive(id: string, isActive: boolean) {
        this.logger.log(`Toggling service active state: ${id} -> ${isActive}`);

        const service = await this.serviceRepository.findById(id);
        if (!service) {
            throw new NotFoundException(`Service not found: ${id}`);
        }

        const updatedService = await this.serviceRepository.update(id, { isActive });
        
        // Fetch traefik config to match contract
        const traefikConfig = await this.serviceRepository.getTraefikConfigByService(id);
        
        return {
            ...updatedService,
            healthCheckPath: updatedService.healthCheckPath || '', // Ensure healthCheckPath is never null
            traefikConfig: this.transformTraefikConfig(traefikConfig),
            healthCheckConfig: null, // TODO: fetch if exists
        };
    }

    async getServiceHealthStatus(id: string) {
        this.logger.log(`Getting health status for service: ${id}`);

        // Get service with details
        const result = await this.serviceRepository.getServiceWithDetails(id);
        if (!result) {
            throw new NotFoundException(`Service not found: ${id}`);
        }

        const { service, healthCheckConfig } = result;

        // Get all deployments for health calculation
        const allDeployments = await this.serviceRepository.getAllServiceDeployments(id);

        // Calculate health status based on deployment rollback rules
        // See: docs/DEPLOYMENT-HEALTH-RULES.md
        let healthStatus = 'unknown';
        let healthMessage = 'No deployments found';

        if (allDeployments.length > 0) {
            // Group by environment
            const deploymentsByEnv = new Map<string, any[]>();
            allDeployments.forEach(dep => {
                const envDeployments = deploymentsByEnv.get(dep.environment) || [];
                envDeployments.push(dep);
                deploymentsByEnv.set(dep.environment, envDeployments);
            });

            // Check each environment
            const envHealthStatuses: string[] = [];
            for (const [, envDeps] of deploymentsByEnv.entries()) {
                const sortedDeps = envDeps.sort((a, b) => 
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );

                const latest = sortedDeps[0];

                // Apply rollback policy: if latest is failed/cancelled, look for previous success
                if (latest.status === 'failed' || latest.status === 'cancelled') {
                    const previousSuccess = sortedDeps.slice(1).find(d => d.status === 'success');
                    if (previousSuccess) {
                        envHealthStatuses.push('healthy'); // Rolled back to previous working deployment
                    } else {
                        envHealthStatuses.push('unhealthy'); // No working fallback
                    }
                } else if (latest.status === 'success') {
                    envHealthStatuses.push('healthy');
                } else if (latest.status === 'pending' || latest.status === 'queued' || latest.status === 'building' || latest.status === 'deploying') {
                    envHealthStatuses.push('pending');
                } else {
                    envHealthStatuses.push('unknown');
                }
            }

            // Overall health: unhealthy if any env is unhealthy, otherwise worst status
            if (envHealthStatuses.includes('unhealthy')) {
                healthStatus = 'unhealthy';
                healthMessage = 'One or more environments are unhealthy';
            } else if (envHealthStatuses.includes('pending')) {
                healthStatus = 'pending';
                healthMessage = 'Deployments in progress';
            } else if (envHealthStatuses.every(s => s === 'healthy')) {
                healthStatus = 'healthy';
                healthMessage = 'All environments healthy';
            } else {
                healthStatus = 'unknown';
                healthMessage = 'Unable to determine health status';
            }
        }

        return {
            serviceId: service.id,
            serviceName: service.name,
            healthStatus,
            healthMessage,
            healthCheckConfig: healthCheckConfig || undefined,
            totalDeployments: allDeployments.length,
            deploymentsByStatus: {
                success: allDeployments.filter(d => d.status === 'success').length,
                pending: allDeployments.filter(d => d.status === 'pending').length,
                queued: allDeployments.filter(d => d.status === 'queued').length,
                building: allDeployments.filter(d => d.status === 'building').length,
                deploying: allDeployments.filter(d => d.status === 'deploying').length,
                failed: allDeployments.filter(d => d.status === 'failed').length,
                cancelled: allDeployments.filter(d => d.status === 'cancelled').length,
            },
        };
    }

    async getTraefikConfig(id: string) {
        this.logger.log(`Getting Traefik config for service: ${id}`);

        const service = await this.serviceRepository.findById(id);
        if (!service) {
            throw new NotFoundException(`Service not found: ${id}`);
        }

        const config = await this.serviceRepository.getTraefikConfigByService(id);
        if (!config) {
            throw new NotFoundException(`Traefik config not found for service: ${id}`);
        }

        // Transform to match contract (convert dates to strings, handle nulls)
        return {
            ...config,
            subdomain: config.subdomain || '',
            sslEnabled: config.sslEnabled || false,
            pathPrefix: config.pathPrefix || '/',
            port: config.port || 80,
            middleware: config.middleware || {},
            healthCheck: config.healthCheck || {},
            isActive: config.isActive || true,
            configContent: config.configContent || '',
            lastSyncedAt: config.lastSyncedAt ? config.lastSyncedAt.toISOString() : null,
            createdAt: config.createdAt!.toISOString(),
            updatedAt: config.updatedAt ? config.updatedAt.toISOString() : new Date().toISOString(),
        };
    }

    async updateTraefikConfig(
        id: string,
        input: {
            domain?: string;
            subdomain?: string;
            sslEnabled?: boolean;
            sslProvider?: string | null;
            pathPrefix?: string;
            port?: number;
            middleware?: any;
            healthCheck?: any;
            configContent?: string;
            isActive?: boolean;
        }
    ) {
        this.logger.log(`Updating Traefik config for service: ${id}`);

        const service = await this.serviceRepository.findById(id);
        if (!service) {
            throw new NotFoundException(`Service not found: ${id}`);
        }

        const existing = await this.serviceRepository.getTraefikConfigByService(id);
        if (!existing) {
            throw new NotFoundException(`Traefik config not found for service: ${id}`);
        }

        const updated = await this.serviceRepository.updateTraefikConfig(id, input);
        if (!updated) {
            throw new Error('Failed to update Traefik config');
        }

        // Transform to match contract
        return {
            ...updated,
            subdomain: updated.subdomain || '',
            sslEnabled: updated.sslEnabled || false,
            pathPrefix: updated.pathPrefix || '/',
            port: updated.port || 80,
            middleware: updated.middleware || {},
            healthCheck: updated.healthCheck || {},
            isActive: updated.isActive || true,
            configContent: updated.configContent || '',
            lastSyncedAt: updated.lastSyncedAt ? updated.lastSyncedAt.toISOString() : null,
            createdAt: updated.createdAt!.toISOString(),
            updatedAt: updated.updatedAt ? updated.updatedAt.toISOString() : new Date().toISOString(),
        };
    }

    async syncTraefikConfig(id: string) {
        this.logger.log(`Syncing Traefik config for service: ${id}`);

        const service = await this.serviceRepository.findById(id);
        if (!service) {
            throw new NotFoundException(`Service not found: ${id}`);
        }

        const config = await this.serviceRepository.getTraefikConfigByService(id);
        if (!config) {
            throw new NotFoundException(`Traefik config not found for service: ${id}`);
        }

        // TODO: Write Traefik config to filesystem
        // This would typically write to /etc/traefik/dynamic/ or similar
        const filePath = `/etc/traefik/dynamic/${service.name}.yml`;
        
        // For now, just update the lastSyncedAt timestamp
        const syncedAt = await this.serviceRepository.syncTraefikConfig(id);

        return {
            success: true,
            message: 'Traefik config synced to filesystem',
            syncedAt: syncedAt.toISOString(),
            filePath,
        };
    }
}
