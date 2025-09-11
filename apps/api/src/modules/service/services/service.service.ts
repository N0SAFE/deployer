import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ServiceRepository, type CreateServiceData, type UpdateServiceData, type ServiceLogsFilter } from '../repositories/service.repository';
import { TraefikService } from '../../traefik/services/traefik.service';
@Injectable()
export class ServiceService {
    private readonly logger = new Logger(ServiceService.name);
    constructor(private readonly serviceRepository: ServiceRepository, private readonly traefikService: TraefikService) { }
    async createService(data: CreateServiceData) {
        this.logger.log(`Creating service: ${data.name} in project: ${data.projectId}`);
        try {
            // Create the service in database
            const service = await this.serviceRepository.create(data);
            this.logger.log(`Service created with ID: ${service.id}`);
            // Automatically create Traefik configuration for the service
            await this.createTraefikConfigForService(service);
            return service;
        }
        catch (error) {
            const err = error as Error;
            this.logger.error(`Error creating service: ${err.message}`, err.stack);
            throw error;
        }
    }
    private async createTraefikConfigForService(service: any) {
        this.logger.log(`Creating Traefik configuration for service: ${service.id}`);
        try {
            // TODO: Implement service-based Traefik configuration with new schema
            // For now, we'll create minimal configs directly in the database
            
            this.logger.log(`Traefik configuration placeholder created for service: ${service.id}`);
        }
        catch (error) {
            const err = error as Error;
            this.logger.error(`Error creating Traefik config for service ${service.id}: ${err.message}`, err.stack);
            // Don't throw error here to avoid blocking service creation
        }
    }
    private async ensureTraefikInstanceForProject(projectId: string) {
        this.logger.log(`Ensuring Traefik configuration exists for project: ${projectId}`);
        
        try {
            // TODO: Implement project-based Traefik configuration lookup with new schema
            // For now, return a placeholder instance object
            
            this.logger.log(`Traefik configuration placeholder for project: ${projectId}`);
            return {
                id: `traefik-${projectId}`,
                name: `traefik-${projectId}`,
                projectId: projectId
            };
            
        } catch (error) {
            const err = error as Error;
            this.logger.error(`Error ensuring Traefik instance for project ${projectId}: ${err.message}`, err.stack);
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
        // If port changed, update Traefik configuration
        if (data.port && data.port !== existingService.port) {
            await this.updateTraefikConfigForService(updatedService);
        }
        return updatedService;
    }
    private async updateTraefikConfigForService(service: any) {
        this.logger.log(`Updating Traefik configuration for service: ${service.id}`);
        try {
            // TODO: Implement Traefik configuration update with new schema
            // For now, we'll skip the complex instance-based updates
            
            this.logger.log(`Traefik config update placeholder for service: ${service.id}`);
        }
        catch (error) {
            const err = error as Error;
            this.logger.error(`Error updating Traefik config for service ${service.id}: ${err.message}`, err.stack);
        }
    }
    async deleteService(id: string) {
        this.logger.log(`Deleting service: ${id}`);
        const service = await this.serviceRepository.findById(id);
        if (!service) {
            throw new NotFoundException(`Service not found: ${id}`);
        }
        // Clean up Traefik configurations
        await this.cleanupTraefikConfigForService(service);
        // Delete the service
        await this.serviceRepository.delete(id);
        return { success: true, message: 'Service deleted successfully' };
    }
    private async cleanupTraefikConfigForService(service: any) {
        this.logger.log(`Cleaning up Traefik configuration for service: ${service.id}`);
        try {
            // TODO: Implement Traefik configuration cleanup with new schema
            // For now, we'll skip the complex instance-based cleanup
            
            this.logger.log(`Traefik cleanup placeholder for service: ${service.id}`);
        }
        catch (error) {
            const err = error as Error;
            this.logger.error(`Error cleaning up Traefik config for service ${service.id}: ${err.message}`, err.stack);
        }
    }
    async getServiceLogs(serviceId: string, deploymentId?: string, filter: ServiceLogsFilter = {}, limit = 100, offset = 0) {
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
        const logs = await this.serviceRepository.findDeploymentLogs(targetDeploymentId, filter, limit, offset);
        const total = logs.length; // This is simplified - in production, you'd do a separate count query
        return {
            logs: logs.map(log => ({
                id: log.id,
                timestamp: log.timestamp,
                level: log.level,
                message: log.message,
                service: log.service || service.name,
                stage: log.stage,
                phase: log.phase,
                step: log.step,
                metadata: log.metadata,
            })),
            total,
            hasMore: offset + limit < total
        };
    }
    async addServiceLog(serviceId: string, deploymentId: string, logData: {
        level: 'info' | 'warn' | 'error' | 'debug';
        message: string;
        phase?: string;
        step?: string;
        stage?: string;
        metadata?: Record<string, any>;
    }) {
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
        return {
            serviceId,
            serviceName: service.name,
            isActive: service.isActive,
            deploymentCount: activeDeployments.length,
            status: activeDeployments.length > 0 ? 'running' : 'stopped',
            healthCheckUrl: service.healthCheckPath ?
                `http://${service.name}.${service.projectId}.localhost${service.healthCheckPath}` : null,
            lastDeployment: activeDeployments.length > 0 ? {
                id: activeDeployments[0].id,
                status: activeDeployments[0].status,
                createdAt: activeDeployments[0].createdAt,
                updatedAt: activeDeployments[0].updatedAt,
            } : null,
        };
    }
    async getServiceMetrics(serviceId: string) {
        this.logger.log(`Getting metrics for service: ${serviceId}`);
        const service = await this.serviceRepository.findById(serviceId);
        if (!service) {
            throw new NotFoundException(`Service not found: ${serviceId}`);
        }
        // This would integrate with monitoring systems
        // For now, return mock metrics structure
        return {
            serviceId,
            serviceName: service.name,
            metrics: {
                cpu: {
                    usage: 0, // Would come from monitoring system
                    limit: service.resourceLimits?.cpu || 'unlimited',
                },
                memory: {
                    usage: 0, // Would come from monitoring system  
                    limit: service.resourceLimits?.memory || 'unlimited',
                },
                requests: {
                    total: 0, // Would come from monitoring system
                    rate: 0,
                },
                errors: {
                    count: 0, // Would come from logs/monitoring
                    rate: 0,
                },
            },
            timestamp: new Date(),
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
}
