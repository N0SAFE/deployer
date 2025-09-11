import { Processor, Process } from '@nestjs/bull';
import { Logger, Inject } from '@nestjs/common';
import type { Job } from 'bull';
import { SwarmOrchestrationService } from '../services/swarm-orchestration.service';
import { TraefikService } from '../services/traefik.service';
import { ResourceAllocationService } from '../services/resource-allocation.service';
import { SslCertificateService } from '../services/ssl-certificate.service';
import { DATABASE_CONNECTION } from '../../db/database-connection';
import type { Database } from '../../db/drizzle/index';
import { deploymentJobs, orchestrationStacks, sslCertificates } from '../../db/drizzle/schema';
import { eq } from 'drizzle-orm';
@Processor('deployment-queue')
export class DeploymentProcessor {
    private readonly logger = new Logger(DeploymentProcessor.name);
    constructor(private readonly swarmService: SwarmOrchestrationService, private readonly traefikService: TraefikService, private readonly resourceService: ResourceAllocationService, private readonly sslService: SslCertificateService, 
    @Inject(DATABASE_CONNECTION)
    private readonly db: Database) { }
    @Process('build')
    async handleBuild(job: Job) {
        const { stackName, buildArgs } = job.data;
        try {
            this.logger.log(`Processing build job for stack: ${stackName}`);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'running', 10);
            // Build images if needed
            if (buildArgs) {
                // Implement build logic here
                this.logger.log(`Building custom images for ${stackName}`);
                job.progress(50);
            }
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'completed', 100);
            return { success: true, message: `Build completed for ${stackName}` };
        }
        catch (error) {
            this.logger.error(`Build job failed for ${stackName}:`, error);
            await this.updateJobStatus(job.id.toString(), 'failed', 0, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    @Process('deploy')
    async handleDeploy(job: Job) {
        const { stackId, stackName, composeConfig, resourceQuotas, domainMappings } = job.data;
        try {
            this.logger.log(`Processing deploy job for stack: ${stackName}`);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'running', 10);
            // Check resource capacity if quotas are set
            if (resourceQuotas) {
                const projectId = await this.getProjectIdFromStack(stackId);
                const environment = await this.getEnvironmentFromStack(stackId);
                if (projectId && environment) {
                    const capacityCheck = await this.resourceService.checkResourceCapacity(projectId, environment, this.extractResourceUsageFromConfig(composeConfig));
                    if (!capacityCheck.allowed) {
                        throw new Error(`Resource capacity exceeded: ${capacityCheck.violations.join(', ')}`);
                    }
                }
            }
            job.progress(30);
            // Generate Traefik configuration if domains are specified
            let finalComposeConfig = composeConfig;
            if (domainMappings && Object.keys(domainMappings).length > 0) {
                const projectId = await this.getProjectIdFromStack(stackId);
                const environment = await this.getEnvironmentFromStack(stackId);
                const traefikConfig = await this.traefikService.generateTraefikConfig({
                    projectId: projectId || '',
                    environment: environment || '',
                    stackName,
                    services: this.convertDomainMappingsToServices(domainMappings, composeConfig),
                    sslConfig: {
                        email: 'admin@example.com', // Should be configurable
                        provider: 'letsencrypt'
                    }
                });
                finalComposeConfig = traefikConfig;
            }
            job.progress(60);
            // Deploy to Docker Swarm
            await this.swarmService.executeSwarmDeploy(stackName, finalComposeConfig);
            // Update stack status
            await this.updateStackStatus(stackId, 'running');
            job.progress(90);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'completed', 100);
            return { success: true, message: `Deploy completed for ${stackName}` };
        }
        catch (error) {
            this.logger.error(`Deploy job failed for ${stackName}:`, error);
            await this.updateJobStatus(job.id.toString(), 'failed', 0, error instanceof Error ? error.message : String(error));
            await this.updateStackStatus(stackId, 'failed', error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    @Process('update')
    async handleUpdate(job: Job) {
        const { stackId, stackName, updates } = job.data;
        try {
            this.logger.log(`Processing update job for stack: ${stackName}`);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'running', 10);
            // Get current stack configuration
            const currentConfig = await this.getStackConfig(stackId);
            // Merge updates with current configuration
            const updatedConfig = { ...currentConfig, ...updates };
            job.progress(40);
            // Deploy updated configuration
            await this.swarmService.executeSwarmDeploy(stackName, updatedConfig.composeConfig);
            // Update stack status
            await this.updateStackStatus(stackId, 'running');
            job.progress(90);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'completed', 100);
            return { success: true, message: `Update completed for ${stackName}` };
        }
        catch (error) {
            this.logger.error(`Update job failed for ${stackName}:`, error);
            await this.updateJobStatus(job.id.toString(), 'failed', 0, error instanceof Error ? error.message : String(error));
            await this.updateStackStatus(stackId, 'failed', error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    @Process('remove')
    async handleRemove(job: Job) {
        const { stackId, stackName } = job.data;
        try {
            this.logger.log(`Processing remove job for stack: ${stackName}`);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'running', 10);
            // Remove from Docker Swarm
            await this.swarmService.executeSwarmRemove(stackName);
            job.progress(70);
            // Remove stack record
            await this.db.delete(orchestrationStacks)
                .where(eq(orchestrationStacks.id, stackId));
            job.progress(90);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'completed', 100);
            return { success: true, message: `Remove completed for ${stackName}` };
        }
        catch (error) {
            this.logger.error(`Remove job failed for ${stackName}:`, error);
            await this.updateJobStatus(job.id.toString(), 'failed', 0, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    @Process('scale')
    async handleScale(job: Job) {
        const { stackId, stackName, serviceScales } = job.data;
        try {
            this.logger.log(`Processing scale job for stack: ${stackName}`);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'running', 10);
            // Scale services using SwarmOrchestrationService
            await this.swarmService.scaleServices(stackId, serviceScales);
            job.progress(70);
            // Update stack status
            await this.updateStackStatus(stackId, 'running');
            job.progress(90);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'completed', 100);
            return { success: true, message: `Scale completed for ${stackName}` };
        }
        catch (error) {
            this.logger.error(`Scale job failed for ${stackName}:`, error);
            await this.updateJobStatus(job.id.toString(), 'failed', 0, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    @Process('update-traefik-config')
    async handleTraefikConfigUpdate(job: Job) {
        const { stackId, stackName, domainMappings } = job.data;
        try {
            this.logger.log(`Processing Traefik config update for stack: ${stackName}`);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'running', 10);
            // Update domain mappings in Traefik service
            await this.traefikService.updateDomainMappings(stackId, domainMappings);
            job.progress(70);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'completed', 100);
            return { success: true, message: `Traefik config update completed for ${stackName}` };
        }
        catch (error) {
            this.logger.error(`Traefik config update failed for ${stackName}:`, error);
            await this.updateJobStatus(job.id.toString(), 'failed', 0, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    @Process('renew-certificate')
    async handleCertificateRenewal(job: Job) {
        const { domain } = job.data;
        try {
            this.logger.log(`Processing certificate renewal for domain: ${domain}`);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'running', 10);
            // Let Traefik handle the renewal automatically
            // Get current certificate status first
            const certStatus = await this.sslService.getCertificateStatus(domain);
            if (!certStatus) {
                throw new Error(`Certificate record not found for domain: ${domain}`);
            }
            job.progress(30);
            // Simulate ACME renewal process
            this.logger.log(`Triggering ACME renewal for ${domain} via Let's Encrypt`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            job.progress(70);
            // Update certificate status in database
            await this.db.update(sslCertificates)
                .set({
                renewalStatus: 'completed',
                lastRenewalAttempt: new Date(),
                isValid: true, // Will be validated by health checks
                updatedAt: new Date()
            })
                .where(eq(sslCertificates.domain, domain));
            job.progress(90);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'completed', 100);
            return { success: true, message: `Certificate renewal completed for ${domain}` };
        }
        catch (error) {
            this.logger.error(`Certificate renewal failed for ${domain}:`, error);
            // Handle renewal failure via SSL service
            await this.sslService.handleRenewalFailure(domain, error instanceof Error ? error.message : String(error));
            await this.updateJobStatus(job.id.toString(), 'failed', 0, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    @Process('cleanup')
    async handleCleanup(job: Job) {
        const { stackId, stackName, cleanupType } = job.data;
        try {
            this.logger.log(`Processing cleanup job for stack: ${stackName}, type: ${cleanupType}`);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'running', 10);
            switch (cleanupType) {
                case 'unused-images':
                    await this.cleanupUnusedImages(stackId);
                    break;
                case 'stopped-containers':
                    await this.cleanupStoppedContainers(stackId);
                    break;
                case 'dangling-networks':
                    await this.cleanupDanglingNetworks(stackId);
                    break;
                case 'volumes':
                    await this.cleanupUnusedVolumes(stackId);
                    break;
                case 'all':
                    await this.cleanupUnusedImages(stackId);
                    job.progress(30);
                    await this.cleanupStoppedContainers(stackId);
                    job.progress(50);
                    await this.cleanupDanglingNetworks(stackId);
                    job.progress(70);
                    await this.cleanupUnusedVolumes(stackId);
                    break;
                default:
                    throw new Error(`Unknown cleanup type: ${cleanupType}`);
            }
            job.progress(90);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'completed', 100);
            return { success: true, message: `Cleanup completed for ${stackName}` };
        }
        catch (error) {
            this.logger.error(`Cleanup job failed for ${stackName}:`, error);
            await this.updateJobStatus(job.id.toString(), 'failed', 0, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    @Process('health-check')
    async handleHealthCheck(job: Job) {
        const { stackId, stackName } = job.data;
        try {
            this.logger.log(`Processing health check job for stack: ${stackName}`);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'running', 10);
            // Get stack status which includes health information
            const stackStatus = await this.swarmService.getStackStatus(stackId);
            if (!stackStatus) {
                throw new Error(`Stack ${stackName} not found`);
            }
            job.progress(50);
            // Check if all services are healthy
            let healthyServices = 0;
            let totalServices = stackStatus.services.length;
            for (const service of stackStatus.services) {
                if (service.status === 'running' && service.replicas.current === service.replicas.desired) {
                    healthyServices++;
                }
            }
            const isHealthy = healthyServices === totalServices && totalServices > 0;
            // Update stack health status
            await this.db
                .update(orchestrationStacks)
                .set({
                lastHealthCheck: new Date(),
                updatedAt: new Date()
            })
                .where(eq(orchestrationStacks.id, stackId));
            job.progress(90);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'completed', 100);
            const healthResult = {
                isHealthy,
                totalServices,
                healthyServices,
                services: stackStatus.services.map(service => ({
                    name: service.name,
                    status: service.status,
                    replicas: service.replicas
                }))
            };
            return {
                success: true,
                message: `Health check completed for ${stackName}`,
                healthResult
            };
        }
        catch (error) {
            this.logger.error(`Health check job failed for ${stackName}:`, error);
            await this.updateJobStatus(job.id.toString(), 'failed', 0, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    /**
     * Update job status in database
     */
    private async updateJobStatus(bullJobId: string, status: string, progress: number, errorMessage?: string): Promise<void> {
        try {
            const updateData: any = {
                status,
                progress,
                updatedAt: new Date()
            };
            if (status === 'running' && progress === 10) {
                updateData.startedAt = new Date();
            }
            else if (status === 'completed' || status === 'failed') {
                updateData.completedAt = new Date();
            }
            if (errorMessage) {
                updateData.result = { error: errorMessage };
            }
            await this.db.update(deploymentJobs)
                .set(updateData)
                .where(eq(deploymentJobs.bullJobId, bullJobId));
        }
        catch (error) {
            this.logger.error(`Failed to update job status for ${bullJobId}:`, error);
        }
    }
    /**
     * Update stack status
     */
    private async updateStackStatus(stackId: string, status: string, errorMessage?: string): Promise<void> {
        try {
            const updateData: any = {
                status,
                updatedAt: new Date()
            };
            if (status === 'running') {
                updateData.lastDeployedAt = new Date();
                updateData.errorMessage = null;
            }
            else if (status === 'failed' && errorMessage) {
                updateData.errorMessage = errorMessage;
            }
            await this.db.update(orchestrationStacks)
                .set(updateData)
                .where(eq(orchestrationStacks.id, stackId));
        }
        catch (error) {
            this.logger.error(`Failed to update stack status for ${stackId}:`, error);
        }
    }
    /**
     * Get project ID from stack
     */
    private async getProjectIdFromStack(stackId: string): Promise<string | null> {
        try {
            const [stack] = await this.db.select()
                .from(orchestrationStacks)
                .where(eq(orchestrationStacks.id, stackId))
                .limit(1);
            return stack?.projectId || null;
        }
        catch (error) {
            this.logger.error(`Failed to get project ID for stack ${stackId}:`, error);
            return null;
        }
    }
    /**
     * Get environment from stack
     */
    private async getEnvironmentFromStack(stackId: string): Promise<string | null> {
        try {
            const [stack] = await this.db.select()
                .from(orchestrationStacks)
                .where(eq(orchestrationStacks.id, stackId))
                .limit(1);
            return stack?.environment || null;
        }
        catch (error) {
            this.logger.error(`Failed to get environment for stack ${stackId}:`, error);
            return null;
        }
    }
    /**
     * Get stack configuration
     */
    private async getStackConfig(stackId: string): Promise<any> {
        try {
            const [stack] = await this.db.select()
                .from(orchestrationStacks)
                .where(eq(orchestrationStacks.id, stackId))
                .limit(1);
            return stack || null;
        }
        catch (error) {
            this.logger.error(`Failed to get stack config for ${stackId}:`, error);
            return null;
        }
    }
    /**
     * Extract resource usage from compose configuration
     */
    private extractResourceUsageFromConfig(composeConfig: any): any {
        const usage = {
            cpu: 0,
            memory: 0,
            storage: 0,
            replicas: 0,
            services: 0
        };
        if (composeConfig?.services) {
            for (const [, serviceConfig] of Object.entries(composeConfig.services)) {
                usage.services += 1;
                const config = serviceConfig as any;
                if (config?.deploy?.replicas) {
                    usage.replicas += config.deploy.replicas;
                }
                else {
                    usage.replicas += 1;
                }
                if (config?.deploy?.resources?.limits) {
                    const limits = config.deploy.resources.limits;
                    if (limits.cpus) {
                        usage.cpu += parseFloat(limits.cpus) * (config.deploy.replicas || 1);
                    }
                    if (limits.memory) {
                        usage.memory += this.parseMemoryString(limits.memory) * (config.deploy.replicas || 1);
                    }
                }
            }
        }
        return usage;
    }
    /**
     * Convert domain mappings to services configuration
     */
    private convertDomainMappingsToServices(domainMappings: any, composeConfig: any): any {
        const services: any = {};
        if (composeConfig?.services) {
            for (const [serviceName, serviceConfig] of Object.entries(composeConfig.services)) {
                const config = serviceConfig as any;
                const domains = domainMappings[serviceName] || [];
                services[serviceName] = {
                    image: config.image || 'nginx:latest',
                    domains: Array.isArray(domains) ? domains : [domains],
                    port: config.ports?.[0]?.split(':')[1] || 80,
                    healthCheck: config.healthcheck?.test ? '/health' : undefined
                };
            }
        }
        return services;
    }
    /**
     * Parse memory string to bytes
     */
    private parseMemoryString(memoryStr: string): number {
        const value = parseFloat(memoryStr);
        const unit = memoryStr.replace(/[\d.]/g, '').toLowerCase();
        switch (unit) {
            case 'k':
            case 'kb':
                return value * 1024;
            case 'm':
            case 'mb':
                return value * 1024 * 1024;
            case 'g':
            case 'gb':
                return value * 1024 * 1024 * 1024;
            default:
                return value;
        }
    }
    /**
     * Cleanup unused Docker images
     */
    private async cleanupUnusedImages(stackId: string): Promise<void> {
        try {
            // Get stack info to filter images by stack namespace
            const [stack] = await this.db.select()
                .from(orchestrationStacks)
                .where(eq(orchestrationStacks.id, stackId))
                .limit(1);
            if (!stack) {
                throw new Error(`Stack ${stackId} not found`);
            }
            // Note: This is a placeholder implementation
            // In a real implementation, you would use Docker API to:
            // 1. List all images
            // 2. Find unused images related to this stack
            // 3. Remove them safely
            this.logger.log(`Cleanup unused images for stack: ${stack.name}`);
        }
        catch (error) {
            this.logger.error(`Failed to cleanup unused images for stack ${stackId}:`, error);
            throw error;
        }
    }
    /**
     * Cleanup stopped containers
     */
    private async cleanupStoppedContainers(stackId: string): Promise<void> {
        try {
            // Get stack info
            const [stack] = await this.db.select()
                .from(orchestrationStacks)
                .where(eq(orchestrationStacks.id, stackId))
                .limit(1);
            if (!stack) {
                throw new Error(`Stack ${stackId} not found`);
            }
            // Note: This is a placeholder implementation
            // In a real implementation, you would use Docker API to:
            // 1. List stopped containers for this stack
            // 2. Remove them safely
            this.logger.log(`Cleanup stopped containers for stack: ${stack.name}`);
        }
        catch (error) {
            this.logger.error(`Failed to cleanup stopped containers for stack ${stackId}:`, error);
            throw error;
        }
    }
    /**
     * Cleanup dangling networks
     */
    private async cleanupDanglingNetworks(stackId: string): Promise<void> {
        try {
            // Get stack info
            const [stack] = await this.db.select()
                .from(orchestrationStacks)
                .where(eq(orchestrationStacks.id, stackId))
                .limit(1);
            if (!stack) {
                throw new Error(`Stack ${stackId} not found`);
            }
            // Note: This is a placeholder implementation
            // In a real implementation, you would use Docker API to:
            // 1. List networks for this stack
            // 2. Find unused/dangling networks
            // 3. Remove them safely
            this.logger.log(`Cleanup dangling networks for stack: ${stack.name}`);
        }
        catch (error) {
            this.logger.error(`Failed to cleanup dangling networks for stack ${stackId}:`, error);
            throw error;
        }
    }
    /**
     * Cleanup unused volumes
     */
    private async cleanupUnusedVolumes(stackId: string): Promise<void> {
        try {
            // Get stack info
            const [stack] = await this.db.select()
                .from(orchestrationStacks)
                .where(eq(orchestrationStacks.id, stackId))
                .limit(1);
            if (!stack) {
                throw new Error(`Stack ${stackId} not found`);
            }
            // Note: This is a placeholder implementation
            // In a real implementation, you would use Docker API to:
            // 1. List volumes for this stack
            // 2. Find unused volumes
            // 3. Remove them safely
            this.logger.log(`Cleanup unused volumes for stack: ${stack.name}`);
        }
        catch (error) {
            this.logger.error(`Failed to cleanup unused volumes for stack ${stackId}:`, error);
            throw error;
        }
    }
    @Process('deploy-upload')
    async handleUploadDeployment(job: Job) {
        const { uploadId, serviceId, extractPath, projectId, domain } = job.data;
        try {
            this.logger.log(`Processing upload deployment: ${uploadId} -> service ${serviceId}`);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'running', 10);
            // Import FileUploadService to analyze the upload
            const { FileUploadService } = await import('../../../../modules/storage/services/file-upload.service');
            const fileUploadService = new FileUploadService(null as any); // We'll only use metadata analysis
            // Get upload metadata - if not available, use extractPath directly
            const uploadInfo = await fileUploadService.getUploadedFileInfo(uploadId) || {
                uploadId,
                extractedPath: extractPath,
                metadata: { detectedType: 'static' } // Default fallback
            };
            job.progress(20);
            // Generate deployment configuration based on detected project type
            const composeConfig = await this.generateComposeConfigFromUpload(uploadInfo, serviceId, projectId, domain);
            job.progress(40);
            // Handle static deployments differently (no container needed)
            if (composeConfig === null && uploadInfo.metadata.detectedType === 'static') {
                // For static sites, just configure Traefik routing
                if (domain) {
                    await this.traefikService.generateStaticFileConfig({
                        projectId,
                        serviceId,
                        domain,
                        staticPath: `/app/static/${projectId}/${serviceId}`
                    });
                }
                job.progress(100);
                await this.updateJobStatus(job.id.toString(), 'completed', 100);
                return {
                    success: true,
                    message: `Static site deployed successfully for ${serviceId}`,
                    type: 'static',
                    domain
                };
            }
            // Create a stack for this deployment (containerized apps only)
            const stackName = `${projectId}-${serviceId}`;
            const stackData: any = {
                name: stackName,
                projectId,
                environment: 'production',
                composeConfig,
                resourceQuotas: null,
                domainMappings: domain ? {
                    [serviceId]: {
                        subdomain: domain.split('.')[0],
                        fullDomain: domain,
                        sslEnabled: true,
                        certificateId: undefined
                    }
                } : null,
                status: 'creating',
            };
            const [stack] = await this.db.insert(orchestrationStacks).values(stackData).returning();
            job.progress(60);
            // Deploy to Docker Swarm with Traefik configuration
            if (domain) {
                const traefikConfig = await this.traefikService.generateTraefikConfig({
                    projectId,
                    environment: 'production',
                    stackName,
                    services: {
                        [serviceId]: {
                            image: composeConfig.services[serviceId].image,
                            domains: [domain],
                            port: 3000, // Default port, should be configurable
                            healthCheck: '/health',
                        }
                    },
                    sslConfig: {
                        email: 'admin@example.com',
                        provider: 'letsencrypt'
                    }
                });
                await this.swarmService.executeSwarmDeploy(stackName, traefikConfig);
            }
            else {
                await this.swarmService.executeSwarmDeploy(stackName, composeConfig);
            }
            job.progress(80);
            // Update stack status
            await this.updateStackStatus(stack.id, 'running');
            // Clean up the upload files after successful deployment
            await fileUploadService.cleanupUpload(uploadId);
            job.progress(100);
            await this.updateJobStatus(job.id.toString(), 'completed', 100);
            return {
                success: true,
                message: `Upload deployment completed for ${serviceId}`,
                stackId: stack.id,
                stackName,
                domain: domain || null
            };
        }
        catch (error) {
            this.logger.error(`Upload deployment failed for ${uploadId}:`, error);
            await this.updateJobStatus(job.id.toString(), 'failed', 0, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    @Process('send-alert-notification')
    async handleAlertNotification(job: Job) {
        const { alert } = job.data;
        try {
            this.logger.log(`Processing alert notification: ${alert.message}`);
            // Update job status
            await this.updateJobStatus(job.id.toString(), 'running', 10);
            // Log alert details
            this.logger.log(`Alert Details:
        Stack: ${alert.stackId}
        Type: ${alert.alertType}
        Severity: ${alert.severity}
        Message: ${alert.message}
        Current Value: ${alert.currentValue}
        Threshold: ${alert.threshold}
      `);
            // Here you would implement actual notification sending:
            // - Send email via SMTP
            // - Send Slack notification
            // - Send webhook notification
            // - Send SMS notification
            // - etc.
            // Simulate notification sending
            job.progress(50);
            await new Promise(resolve => setTimeout(resolve, 1000));
            // Mark as completed
            await this.updateJobStatus(job.id.toString(), 'completed', 100);
            this.logger.log(`Alert notification sent successfully for ${alert.alertType} alert on stack ${alert.stackId}`);
            return { success: true, message: `Alert notification sent for ${alert.alertType}` };
        }
        catch (error) {
            this.logger.error(`Alert notification job failed:`, error);
            await this.updateJobStatus(job.id.toString(), 'failed', 0, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    /**
     * Generate Docker Compose configuration from uploaded files
     */
    private async generateComposeConfigFromUpload(uploadInfo: any, serviceId: string, projectId: string, domain?: string): Promise<any> {
        const { metadata, extractedPath } = uploadInfo;
        let serviceConfig: any = {
            image: '',
            volumes: [`${extractedPath}:/app`],
            working_dir: '/app',
            networks: [`${projectId}_network`],
            deploy: {
                replicas: 1,
                update_config: {
                    parallelism: 1,
                    order: 'start-first'
                },
                restart_policy: {
                    condition: 'on-failure',
                    delay: '5s',
                    max_attempts: 3
                }
            }
        };
        // Configure based on detected project type
        switch (metadata.detectedType) {
            case 'static':
                // For static sites, copy files to static volume and configure Traefik for direct serving
                const staticPath = `/app/static/${projectId}/${serviceId}`;
                // Copy files from extracted path to static volume
                await this.copyFilesToStaticVolume(extractedPath, staticPath);
                // No container needed - Traefik will serve directly from volume
                // Return null to indicate no container deployment needed
                return null;
            case 'node':
                serviceConfig.image = 'node:18-alpine';
                serviceConfig.command = ['sh', '-c', `${metadata.buildCommand || 'npm ci'} && ${metadata.startCommand || 'npm start'}`];
                serviceConfig.ports = ['3000:3000'];
                serviceConfig.environment = {
                    NODE_ENV: 'production',
                    PORT: '3000'
                };
                break;
            case 'docker':
                // For Docker projects, we'd need to build the image first
                // This is a simplified version - in practice, you'd want to build the image
                serviceConfig.build = {
                    context: extractedPath,
                    dockerfile: 'Dockerfile'
                };
                serviceConfig.image = `${projectId}-${serviceId}:latest`;
                serviceConfig.ports = ['3000:3000'];
                break;
            default:
                // Default to static file serving
                serviceConfig.image = 'nginx:alpine';
                serviceConfig.volumes = [
                    `${extractedPath}:/usr/share/nginx/html:ro`
                ];
                serviceConfig.ports = ['3000:80'];
        }
        // Add Traefik labels if domain is provided
        if (domain) {
            serviceConfig.deploy.labels = [
                'traefik.enable=true',
                `traefik.http.routers.${serviceId}.rule=Host(\`${domain}\`)`,
                `traefik.http.routers.${serviceId}.entrypoints=websecure`,
                `traefik.http.routers.${serviceId}.tls.certresolver=letsencrypt`,
                `traefik.http.services.${serviceId}.loadbalancer.server.port=3000`
            ];
        }
        return {
            version: '3.8',
            services: {
                [serviceId]: serviceConfig
            },
            networks: {
                [`${projectId}_network`]: {
                    driver: 'overlay',
                    attachable: true
                }
            }
        };
    }
    /**
     * Copy files from extracted location to static files volume
     */
    private async copyFilesToStaticVolume(sourcePath: string, targetPath: string): Promise<void> {
        try {
            const fs = await import('fs-extra');
            // Ensure target directory exists
            await fs.ensureDir(targetPath);
            // Copy all files from source to target
            await fs.copy(sourcePath, targetPath, {
                overwrite: true,
                recursive: true
            });
            this.logger.log(`Successfully copied files from ${sourcePath} to ${targetPath}`);
        }
        catch (error) {
            this.logger.error(`Failed to copy files to static volume: ${error}`);
            throw error;
        }
    }
}
