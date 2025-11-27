import { Injectable, Logger } from '@nestjs/common';
import { DeploymentRepository } from '../repositories/deployment.repository';
import { ServiceService } from '@/core/modules/service/services/service.service';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface CleanupResult {
    serviceId: string;
    deletedCount: number;
    deletedDeployments: string[];
    keptCount: number;
    message: string;
}

@Injectable()
export class DeploymentCleanupService {
    private readonly logger = new Logger(DeploymentCleanupService.name);

    constructor(
        private readonly deploymentRepository: DeploymentRepository,
        private readonly serviceService: ServiceService,
        private readonly dockerService: DockerService,
    ) {}

    /**
     * Clean up old deployments for a service based on retention policy
     */
    async cleanupOldDeployments(serviceId: string): Promise<CleanupResult> {
        this.logger.log(`Starting cleanup for service: ${serviceId}`);

        try {
            // Get service configuration
            const service = await this.serviceService.getService(serviceId);

            if (!service) {
                throw new Error(`Service ${serviceId} not found`);
            }

            // Get retention policy (default to 5 if not configured)
            const retentionPolicy = service.deploymentRetention || {
                maxSuccessfulDeployments: 5,
                keepArtifacts: true,
                autoCleanup: true,
            };

            // If auto-cleanup is disabled, skip
            if (retentionPolicy.autoCleanup === false) {
                this.logger.log(`Auto-cleanup disabled for service ${serviceId}`);
                return {
                    serviceId,
                    deletedCount: 0,
                    deletedDeployments: [],
                    keptCount: 0,
                    message: 'Auto-cleanup disabled for this service',
                };
            }

            const maxDeployments = retentionPolicy.maxSuccessfulDeployments || 5;
            const keepArtifacts = retentionPolicy.keepArtifacts !== false;

            // Get all successful deployments, sorted by creation date (newest first)
            const { deployments: successfulDeploymentsData } = await this.deploymentRepository.findMany({
                serviceId,
                status: 'success',
                limit: 1000, // Large limit to get all successful deployments
                offset: 0,
            });

            // Map to include builder info from service
            const successfulDeployments = successfulDeploymentsData.map(deployment => ({
                id: deployment.id,
                containerName: deployment.containerName,
                containerImage: deployment.containerImage,
                createdAt: deployment.createdAt,
                builder: service.builderId,
            }));

            // If we have fewer or equal to maxDeployments, nothing to clean
            if (successfulDeployments.length <= maxDeployments) {
                this.logger.log(
                    `Service ${serviceId} has ${successfulDeployments.length} successful deployments ` +
                    `(max: ${maxDeployments}). No cleanup needed.`
                );
                return {
                    serviceId,
                    deletedCount: 0,
                    deletedDeployments: [],
                    keptCount: successfulDeployments.length,
                    message: `Keeping all ${successfulDeployments.length} deployments (within retention limit)`,
                };
            }

            // Deployments to keep (most recent N)
            const deploymentsToKeep = successfulDeployments.slice(0, maxDeployments);
            const deploymentsToDelete = successfulDeployments.slice(maxDeployments);

            this.logger.log(
                `Service ${serviceId}: Keeping ${deploymentsToKeep.length} deployments, ` +
                `deleting ${deploymentsToDelete.length} old deployments`
            );

            // Delete old deployments
            const deletedIds: string[] = [];
            for (const deployment of deploymentsToDelete) {
                try {
                    await this.cleanupDeploymentArtifacts(
                        deployment.id,
                        deployment.containerName,
                        deployment.containerImage,
                        deployment.builder,
                        keepArtifacts
                    );

                    // Delete deployment record from database
                    await this.deploymentRepository.delete(deployment.id);

                    deletedIds.push(deployment.id);
                    this.logger.log(`Deleted deployment: ${deployment.id}`);
                } catch (error) {
                    const err = error as Error;
                    this.logger.error(
                        `Failed to delete deployment ${deployment.id}: ${err.message}`,
                        err.stack
                    );
                    // Continue with other deployments even if one fails
                }
            }

            const result: CleanupResult = {
                serviceId,
                deletedCount: deletedIds.length,
                deletedDeployments: deletedIds,
                keptCount: deploymentsToKeep.length,
                message: `Cleaned up ${deletedIds.length} old deployments, kept ${deploymentsToKeep.length} recent deployments`,
            };

            this.logger.log(result.message);
            return result;
        } catch (error) {
            const err = error as Error;
            this.logger.error(
                `Failed to cleanup deployments for service ${serviceId}: ${err.message}`,
                err.stack
            );
            throw error;
        }
    }

    /**
     * Clean up deployment artifacts (Docker containers, images, files)
     */
    private async cleanupDeploymentArtifacts(
        deploymentId: string,
        containerName: string | null,
        containerImage: string | null,
        builder: string | null,
        keepArtifacts: boolean
    ): Promise<void> {
        this.logger.debug(`Cleaning up artifacts for deployment ${deploymentId}`);

        try {
            // For containerized deployments
            if (containerName) {
                // Stop and remove container if it exists
                try {
                    const containers = await this.dockerService.listContainersByDeployment?.(deploymentId) || [];
                    
                    for (const container of containers) {
                        this.logger.debug(`Stopping container: ${container.name}`);
                        await this.dockerService.stopContainer?.(container.id);
                        
                        this.logger.debug(`Removing container: ${container.name}`);
                        await this.dockerService.removeContainer?.(container.id);
                    }
                } catch (error) {
                    const err = error as Error;
                    this.logger.warn(`Failed to remove container for deployment ${deploymentId}: ${err.message}`);
                    // Continue cleanup even if container removal fails
                }

                // Remove Docker image if configured and image exists
                if (!keepArtifacts && containerImage) {
                    try {
                        this.logger.debug(`Removing Docker image: ${containerImage}`);
                        await this.dockerService.removeImage?.(containerImage);
                    } catch (error) {
                        const err = error as Error;
                        this.logger.warn(`Failed to remove image ${containerImage}: ${err.message}`);
                        // Continue cleanup even if image removal fails
                    }
                }
            }

            // For static deployments
            if (builder === 'static' && !keepArtifacts) {
                try {
                    const staticPath = path.join(
                        process.env.STATIC_FILES_BASE_PATH || '/opt/deployer/static',
                        deploymentId
                    );

                    // Check if directory exists
                    try {
                        await fs.access(staticPath);
                        this.logger.debug(`Removing static files: ${staticPath}`);
                        await fs.rm(staticPath, { recursive: true, force: true });
                    } catch {
                        // Directory doesn't exist or already removed
                        this.logger.debug(`Static files directory not found or already removed: ${staticPath}`);
                    }
                } catch (error) {
                    const err = error as Error;
                    this.logger.warn(`Failed to remove static files for deployment ${deploymentId}: ${err.message}`);
                    // Continue cleanup even if file removal fails
                }
            }

            this.logger.debug(`Artifacts cleanup completed for deployment ${deploymentId}`);
        } catch (error) {
            const err = error as Error;
            this.logger.error(
                `Failed to cleanup artifacts for deployment ${deploymentId}: ${err.message}`,
                err.stack
            );
            // Don't throw - we want to continue with database cleanup even if artifact cleanup fails
        }
    }

    /**
     * Clean up all old deployments across all services
     */
    async cleanupAllServices(): Promise<CleanupResult[]> {
        this.logger.log('Starting cleanup for all services');

        try {
            // Get all services
            const allServices = await this.serviceService.findAll();

            const results: CleanupResult[] = [];

            for (const service of allServices) {
                try {
                    const result = await this.cleanupOldDeployments(service.id);
                    results.push(result);
                } catch (error) {
                    const err = error as Error;
                    this.logger.error(
                        `Failed to cleanup service ${service.id}: ${err.message}`,
                        err.stack
                    );
                    // Continue with other services even if one fails
                }
            }

            const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
            this.logger.log(`Cleanup completed: ${totalDeleted} deployments deleted across ${results.length} services`);

            return results;
        } catch (error) {
            const err = error as Error;
            this.logger.error(`Failed to cleanup all services: ${err.message}`, err.stack);
            throw error;
        }
    }

    /**
     * Get cleanup preview without actually deleting anything
     */
    async previewCleanup(serviceId: string): Promise<{
        willDelete: number;
        willKeep: number;
        deploymentsToDelete: Array<{
            id: string;
            createdAt: Date;
            containerName: string | null;
        }>;
        deploymentsToKeep: Array<{
            id: string;
            createdAt: Date;
            containerName: string | null;
        }>;
    }> {
        // Get service configuration
        const service = await this.serviceService.getService(serviceId);

        if (!service) {
            throw new Error(`Service ${serviceId} not found`);
        }

        const maxDeployments = service.deploymentRetention?.maxSuccessfulDeployments || 5;

        // Get all successful deployments
        const { deployments: successfulDeployments } = await this.deploymentRepository.findMany({
            serviceId,
            status: 'success',
            limit: 1000, // Large limit to get all successful deployments
            offset: 0,
        });

        const deploymentsToKeep = successfulDeployments.slice(0, maxDeployments);
        const deploymentsToDelete = successfulDeployments.slice(maxDeployments);

        return {
            willDelete: deploymentsToDelete.length,
            willKeep: deploymentsToKeep.length,
            deploymentsToDelete,
            deploymentsToKeep,
        };
    }
}
