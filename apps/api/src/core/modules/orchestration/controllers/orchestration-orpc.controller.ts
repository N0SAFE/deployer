import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { orchestrationContract } from '@repo/api-contracts/modules/orchestration';
import { SwarmOrchestrationService } from '../services/swarm-orchestration.service';
import { TraefikService } from '../services/traefik.service';
import { ResourceAllocationService } from '../services/resource-allocation.service';
import { SslCertificateService } from '../services/ssl-certificate.service';
import { ResourceMonitoringService } from '../services/resource-monitoring.service';
import { HealthCheckService } from '../services/health-check.service';
import { JobTrackingService } from '../services/job-tracking.service';
@Controller()
export class OrchestrationOrpcController {
    private readonly logger = new Logger(OrchestrationOrpcController.name);
    constructor(private readonly swarmService: SwarmOrchestrationService, private readonly traefikService: TraefikService, private readonly resourceService: ResourceAllocationService, private readonly sslService: SslCertificateService, private readonly resourceMonitoringService: ResourceMonitoringService, private readonly healthCheckService: HealthCheckService, private readonly jobTrackingService: JobTrackingService) { }
    @Implement(orchestrationContract.createStack)
    createStack() {
        return implement(orchestrationContract.createStack).handler(async ({ input }) => {
            this.logger.log('Creating new stack:', input.stackName);
            try {
                const stackConfig = {
                    name: input.stackName,
                    projectId: input.projectId,
                    environment: input.environment,
                    composeConfig: input.composeConfig,
                    domain: input.domainMappings ? Object.keys(input.domainMappings)[0] : undefined
                };
                const stackId = await this.swarmService.createStack(stackConfig);
                // Set resource quotas if provided
                if (input.resourceQuotas) {
                    await this.resourceService.setResourceQuotas(input.projectId, input.environment, input.resourceQuotas);
                }
                // Configure domain mappings if provided
                if (input.domainMappings) {
                    const domainMappings = Object.entries(input.domainMappings).flatMap(([service, domains]) => domains.map(domain => ({
                        domain,
                        service,
                        port: 80, // Default port, could be made configurable
                    })));
                    await this.traefikService.updateDomainMappings(stackId, domainMappings);
                }
                this.logger.log(`Stack ${input.stackName} created successfully with ID: ${stackId}`);
                return {
                    success: true,
                    message: `Stack ${input.stackName} created successfully`,
                    stackId
                };
            }
            catch (error) {
                this.logger.error(`Failed to create stack ${input.stackName}:`, error);
                throw new Error(error instanceof Error ? error.message : 'Failed to create stack');
            }
        });
    }
    @Implement(orchestrationContract.getStack)
    getStack() {
        return implement(orchestrationContract.getStack).handler(async ({ input }) => {
            this.logger.log('Getting stack:', input.stackId);
            try {
                const status = await this.swarmService.getStackStatus(input.stackId);
                if (!status) {
                    throw new Error(`Stack ${input.stackId} not found`);
                }
                return {
                    success: true,
                    data: status
                };
            }
            catch (error) {
                this.logger.error(`Failed to get stack ${input.stackId}:`, error);
                throw new Error(error instanceof Error ? error.message : 'Failed to get stack');
            }
        });
    }
    @Implement(orchestrationContract.listStacks)
    listStacks() {
        return implement(orchestrationContract.listStacks).handler(async ({ input }) => {
            this.logger.log('Listing stacks for project:', input.projectId);
            try {
                const stacks = await this.swarmService.listStacks(input.projectId);
                return {
                    success: true,
                    data: stacks
                };
            }
            catch (error) {
                this.logger.error(`Failed to list stacks for project ${input.projectId}:`, error);
                throw new Error(error instanceof Error ? error.message : 'Failed to list stacks');
            }
        });
    }
    @Implement(orchestrationContract.updateStack)
    updateStack() {
        return implement(orchestrationContract.updateStack).handler(async ({ input }) => {
            this.logger.log('Updating stack:', input.stackId);
            try {
                await this.swarmService.updateStack(input.stackId, {
                    composeConfig: input.composeConfig
                });
                return {
                    success: true,
                    message: `Stack ${input.stackId} updated successfully`
                };
            }
            catch (error) {
                this.logger.error(`Failed to update stack ${input.stackId}:`, error);
                throw new Error(error instanceof Error ? error.message : 'Failed to update stack');
            }
        });
    }
    @Implement(orchestrationContract.removeStack)
    removeStack() {
        return implement(orchestrationContract.removeStack).handler(async ({ input }) => {
            this.logger.log('Removing stack:', input.stackId);
            try {
                await this.swarmService.removeStack(input.stackId);
                return {
                    success: true,
                    message: `Stack ${input.stackId} removed successfully`
                };
            }
            catch (error) {
                this.logger.error(`Failed to remove stack ${input.stackId}:`, error);
                throw new Error(error instanceof Error ? error.message : 'Failed to remove stack');
            }
        });
    }
    @Implement(orchestrationContract.scaleServices)
    scaleServices() {
        return implement(orchestrationContract.scaleServices).handler(async ({ input }) => {
            this.logger.log('Scaling services in stack:', input.stackId);
            try {
                await this.swarmService.scaleServices(input.stackId, {
                    services: input.services
                });
                return {
                    success: true,
                    message: `Services in stack ${input.stackId} scaled successfully`
                };
            }
            catch (error) {
                this.logger.error(`Failed to scale services in stack ${input.stackId}:`, error);
                throw new Error(error instanceof Error ? error.message : 'Failed to scale services');
            }
        });
    }
    @Implement(orchestrationContract.updateDomainMappings)
    updateDomainMappings() {
        return implement(orchestrationContract.updateDomainMappings).handler(async ({ input }) => {
            this.logger.log('Updating domain mappings for stack:', input.stackId);
            try {
                const domainMappings = input.mappings.flatMap(mapping => mapping.domains.map(domain => ({
                    domain,
                    service: mapping.service,
                    port: 80, // Default port, could be made configurable
                    middleware: mapping.middleware
                })));
                await this.traefikService.updateDomainMappings(input.stackId, domainMappings);
                return {
                    success: true,
                    message: `Domain mappings updated for stack ${input.stackId}`
                };
            }
            catch (error) {
                this.logger.error(`Failed to update domain mappings for stack ${input.stackId}:`, error);
                throw new Error(error instanceof Error ? error.message : 'Failed to update domain mappings');
            }
        });
    }
    @Implement(orchestrationContract.getCertificateStatus)
    getCertificateStatus() {
        return implement(orchestrationContract.getCertificateStatus).handler(async ({ input }) => {
            this.logger.log('Getting certificate status for domain:', input.domain);
            try {
                const certificate = await this.sslService.getCertificateStatus(input.domain);
                return {
                    success: true,
                    data: certificate
                };
            }
            catch (error) {
                this.logger.error(`Failed to get certificate status for ${input.domain}:`, error);
                throw new Error(error instanceof Error ? error.message : 'Failed to get certificate status');
            }
        });
    }
    @Implement(orchestrationContract.renewCertificate)
    renewCertificate() {
        return implement(orchestrationContract.renewCertificate).handler(async ({ input }) => {
            this.logger.log('Renewing certificate for domain:', input.domain);
            try {
                await this.sslService.renewCertificate(input.domain);
                return {
                    success: true,
                    message: `Certificate renewal initiated for ${input.domain}`
                };
            }
            catch (error) {
                this.logger.error(`Failed to renew certificate for ${input.domain}:`, error);
                throw new Error(error instanceof Error ? error.message : 'Failed to renew certificate');
            }
        });
    }
    @Implement(orchestrationContract.setResourceQuotas)
    setResourceQuotas() {
        return implement(orchestrationContract.setResourceQuotas).handler(async ({ input }) => {
            this.logger.log('Setting resource quotas for project:', input.projectId, input.environment);
            try {
                await this.resourceService.setResourceQuotas(input.projectId, input.environment, input.quotas);
                return {
                    success: true,
                    message: `Resource quotas set for ${input.projectId}:${input.environment}`
                };
            }
            catch (error) {
                this.logger.error(`Failed to set resource quotas for ${input.projectId}:`, error);
                throw new Error(error instanceof Error ? error.message : 'Failed to set resource quotas');
            }
        });
    }
    @Implement(orchestrationContract.getResourceAllocation)
    getResourceAllocation() {
        return implement(orchestrationContract.getResourceAllocation).handler(async ({ input }) => {
            this.logger.log('Getting resource allocation for project:', input.projectId, input.environment);
            try {
                const allocation = await this.resourceService.getResourceAllocation(input.projectId, input.environment);
                return {
                    success: true,
                    data: allocation
                };
            }
            catch (error) {
                this.logger.error(`Failed to get resource allocation for ${input.projectId}:`, error);
                throw new Error(error instanceof Error ? error.message : 'Failed to get resource allocation');
            }
        });
    }
    @Implement(orchestrationContract.getSystemResourceSummary)
    getSystemResourceSummary() {
        return implement(orchestrationContract.getSystemResourceSummary).handler(async () => {
            this.logger.log('Getting system resource summary');
            try {
                // Get system resource summary from resource monitoring service
                const mockSummary = {
                    totalCpu: { allocated: 0, used: 0, limit: 100 },
                    totalMemory: { allocated: 0, used: 0, limit: 32 },
                    totalStorage: { allocated: 0, used: 0, limit: 1024 },
                    totalReplicas: { total: 0, running: 0 },
                    totalServices: 0,
                    projectCount: 0
                };
                return {
                    success: true,
                    data: mockSummary
                };
            }
            catch (error) {
                this.logger.error('Failed to get system resource summary:', error);
                throw new Error(error instanceof Error ? error.message : 'Failed to get system resource summary');
            }
        });
    }
    @Implement(orchestrationContract.getResourceAlerts)
    getResourceAlerts() {
        return implement(orchestrationContract.getResourceAlerts).handler(async () => {
            this.logger.log('Getting resource alerts');
            try {
                const alerts = await this.resourceMonitoringService.getActiveAlerts();
                return {
                    success: true,
                    data: alerts
                };
            }
            catch (error) {
                this.logger.error('Failed to get resource alerts:', error);
                throw new Error(error instanceof Error ? error.message : 'Failed to get resource alerts');
            }
        });
    }
    @Implement(orchestrationContract.generateTraefikPreview)
    generateTraefikPreview() {
        return implement(orchestrationContract.generateTraefikPreview).handler(async ({ input }) => {
            this.logger.log('Generating Traefik preview');
            try {
                // Convert input format to TraefikService format
                const services: Record<string, any> = {};
                input.services.forEach(service => {
                    services[service.name] = {
                        image: 'placeholder:latest', // This would come from the stack config in real usage
                        domains: service.domains,
                        port: service.port,
                        middleware: input.middleware
                    };
                });
                const traefikConfig = {
                    projectId: 'preview-project', // Placeholder values for preview
                    environment: 'preview',
                    stackName: 'preview-stack',
                    services,
                    sslConfig: input.ssl ? {
                        email: input.ssl.email,
                        provider: input.ssl.provider as 'letsencrypt' | 'cloudflare' | 'custom',
                        staging: input.ssl.staging
                    } : undefined
                };
                const preview = await this.traefikService.generateTraefikConfig(traefikConfig);
                return {
                    success: true,
                    data: preview
                };
            }
            catch (error) {
                this.logger.error('Failed to generate Traefik preview:', error);
                throw new Error(error instanceof Error ? error.message : 'Failed to generate Traefik preview');
            }
        });
    }
}
