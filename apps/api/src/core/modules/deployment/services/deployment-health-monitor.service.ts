import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DeploymentService } from './deployment.service';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import { DeploymentPhase } from '@/core/interfaces/deployment-phase';
import { DeploymentRepository } from '../repositories/deployment.repository';

/**
 * Deployment Health Monitor Service
 * 
 * Continuously monitors the health of all active deployments and updates their status.
 * Features:
 * - Periodic health checks every 2 minutes
 * - Stuck deployment detection (phase hasn't updated in 5+ minutes)
 * - Automatic restart of unhealthy containers
 * - Database status updates
 * - Comprehensive logging
 * - Graceful startup and shutdown
 */

interface MonitoringStats {
    totalDeployments: number;
    healthyDeployments: number;
    degradedDeployments: number;
    unhealthyDeployments: number;
    stuckDeployments: number;
    restartedContainers: number;
    errors: number;
}

// Result type for container restart operations
interface ContainerRestartResult {
    success: boolean;
    restartedContainers: string[];
    errors: { containerId: string; error: string }[];
}

@Injectable()
export class DeploymentHealthMonitorService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(DeploymentHealthMonitorService.name);
    private isMonitoring = false;
    private stats: MonitoringStats = {
        totalDeployments: 0,
        healthyDeployments: 0,
        degradedDeployments: 0,
        unhealthyDeployments: 0,
        stuckDeployments: 0,
        restartedContainers: 0,
        errors: 0,
    };

    constructor(
        private readonly deploymentService: DeploymentService,
        private readonly deploymentRepository: DeploymentRepository,
        private readonly dockerService: DockerService,
    ) {}

    onApplicationBootstrap() {
        this.logger.log('Deployment Health Monitor Service starting...');
        this.isMonitoring = true;
        
        // Run initial health check after a short delay to allow other services to start
        setTimeout(() => {
            this.performHealthCheck().catch((error: unknown) => {
                this.logger.error('Initial health check failed:', error);
            });
        }, 30000); // 30 seconds delay
    }

    onApplicationShutdown() {
        this.logger.log('Deployment Health Monitor Service stopping...');
        this.isMonitoring = false;
    }

    /**
     * Scheduled health check that runs every 2 minutes
     */
    @Cron('0 */2 * * * *') // Every 2 minutes
    async performHealthCheck(): Promise<void> {
        if (!this.isMonitoring) {
            return;
        }

        const startTime = Date.now();
        this.logger.log('Starting periodic health check...');

        try {
            // Reset stats for this run
            this.stats = {
                totalDeployments: 0,
                healthyDeployments: 0,
                degradedDeployments: 0,
                unhealthyDeployments: 0,
                stuckDeployments: 0,
                restartedContainers: 0,
                errors: 0,
            };

            // Check for stuck deployments first (phase hasn't updated in 5+ minutes)
            await this.checkStuckDeployments();

            // Get all active deployments (success or deploying)
            // Use repository to fetch deployments with containerized services
            const { deployments: activeDeployments } = await this.deploymentRepository.findMany({
                status: ['success', 'deploying'],
                limit: 1000, // Large limit to get all active deployments
                offset: 0,
            });

            // Filter out deployments without containers (static sites)
            // Static deployments don't have Docker containers to monitor
            const deploymentsWithContainers = activeDeployments.filter(
                deployment => deployment.containerName !== null && deployment.containerName !== ''
            );

            this.stats.totalDeployments = deploymentsWithContainers.length;

            if (deploymentsWithContainers.length === 0) {
                this.logger.log('No active deployments with containers to monitor');
                return;
            }

            const skippedCount = activeDeployments.length - deploymentsWithContainers.length;
            if (skippedCount > 0) {
                this.logger.log(
                    `Skipping ${String(skippedCount)} static deployments (no containers), ` +
                    `monitoring ${String(deploymentsWithContainers.length)} containerized deployments`
                );
            }

            // Check each deployment
            const healthPromises = deploymentsWithContainers.map(deployment => 
                this.checkDeploymentHealth(deployment.id)
            );

            await Promise.allSettled(healthPromises);

            const duration = Date.now() - startTime;
            this.logger.log(
                `Health check completed in ${String(duration)}ms - ` +
                `${String(this.stats.healthyDeployments)} healthy, ` +
                `${String(this.stats.degradedDeployments)} degraded, ` +
                `${String(this.stats.unhealthyDeployments)} unhealthy, ` +
                `${String(this.stats.stuckDeployments)} stuck (marked failed), ` +
                `${String(this.stats.restartedContainers)} containers restarted, ` +
                `${String(this.stats.errors)} errors`
            );

            // Log summary if there are issues
            if (this.stats.degradedDeployments > 0 || this.stats.unhealthyDeployments > 0 || this.stats.stuckDeployments > 0) {
                await this.logMonitoringSummary();
            }

        } catch (error) {
            this.logger.error('Health check failed:', error);
            this.stats.errors++;
        }
    }

    /**
     * Check for stuck deployments (phase hasn't updated in 5+ minutes)
     */
    private async checkStuckDeployments(): Promise<void> {
        try {
            // Check for deployments stuck for more than 5 minutes
            const stuckDeployments = await this.deploymentRepository.findStuckDeployments(5);

            this.stats.stuckDeployments = stuckDeployments.length;

            if (stuckDeployments.length > 0) {
                this.logger.warn(`Found ${String(stuckDeployments.length)} stuck deployments`);
                
                for (const deployment of stuckDeployments) {
                    this.logger.warn(
                        `Deployment ${deployment.id} stuck in phase ${String(deployment.phase)} ` +
                        `(last update: ${String(deployment.phaseUpdatedAt)})`
                    );
                    
                    // Mark as failed after being stuck
                    await this.deploymentService.updateDeploymentPhase(
                        deployment.id,
                        DeploymentPhase.FAILED,
                        0,
                        {
                            error: 'Deployment stuck - no progress for 5+ minutes',
                            stuckPhase: deployment.phase,
                            stuckAt: deployment.phaseUpdatedAt?.toISOString(),
                        }
                    );
                    
                    await this.deploymentService.updateDeploymentStatus(deployment.id, 'failed');
                }
            }
        } catch (error) {
            this.logger.error('Error checking stuck deployments:', error);
            this.stats.errors++;
        }
    }

    /**
     * Check health of a specific deployment
     */
    private async checkDeploymentHealth(deploymentId: string): Promise<void> {
        try {
            // Get detailed health status
            const healthStatus = await this.deploymentService.monitorDeploymentHealth(deploymentId);
            
            // Track deployment status based on health
            switch (healthStatus.status) {
                case 'healthy':
                    this.stats.healthyDeployments++;
                    break;
                case 'degraded':
                    this.stats.degradedDeployments++;
                    this.logger.warn(`Deployment ${deploymentId} is degraded`);
                    break;
                case 'unhealthy':
                case 'unknown':
                    this.stats.unhealthyDeployments++;
                    this.logger.error(`Deployment ${deploymentId} is unhealthy`);
                    
                    // Attempt to restart unhealthy containers
                    await this.attemptContainerRestart(deploymentId);
                    break;
            }

        } catch (error) {
            this.logger.error(`Error checking health for deployment ${deploymentId}:`, error);
            this.stats.errors++;
        }
    }

    /**
     * Attempt to restart unhealthy containers
     */
    private async attemptContainerRestart(deploymentId: string): Promise<void> {
        try {
            this.logger.log(`Attempting to restart unhealthy containers for deployment ${deploymentId}`);
            
            const restartResult = await this.deploymentService.restartUnhealthyContainers(deploymentId);
            
            if (restartResult.success && restartResult.restartedContainers.length > 0) {
                this.stats.restartedContainers += restartResult.restartedContainers.length;
                this.logger.log(
                    `Successfully restarted ${String(restartResult.restartedContainers.length)} containers ` +
                    `for deployment ${deploymentId}: ${restartResult.restartedContainers.join(', ')}`
                );
                
                // Log the restart action
                await this.logRestartAction(deploymentId, restartResult);
            } else {
                this.logger.warn(`Failed to restart containers for deployment ${deploymentId}:`, restartResult.errors);
            }

        } catch (error) {
            this.logger.error(`Error restarting containers for deployment ${deploymentId}:`, error);
            this.stats.errors++;
        }
    }

    /**
     * Log restart actions to deployment logs
     */
    private async logRestartAction(deploymentId: string, restartResult: ContainerRestartResult): Promise<void> {
        try {
            await this.deploymentRepository.addLog(deploymentId, {
                level: 'info',
                message: `Automatic restart: ${String(restartResult.restartedContainers.length)} containers restarted`,
                service: 'health-monitor',
                stage: 'monitoring',
                metadata: {
                    containerLogs: JSON.stringify({
                        restartedContainers: restartResult.restartedContainers,
                        errors: restartResult.errors,
                        automatic: true,
                    }),
                },
                timestamp: new Date(),
            });
        } catch (error) {
            this.logger.error(`Failed to log restart action for deployment ${deploymentId}:`, error);
        }
    }

    /**
     * Log monitoring summary to deployment logs
     */
    private async logMonitoringSummary(): Promise<void> {
        try {
            // Log a summary to the most recent deployment if there are issues
            const { deployments: recentDeployments } = await this.deploymentRepository.findMany({
                status: ['success', 'deploying'],
                limit: 1,
                offset: 0,
            });

            if (recentDeployments[0]) {
                await this.deploymentRepository.addLog(recentDeployments[0].id, {
                    level: 'warn',
                    message: `Health monitoring summary: ${String(this.stats.degradedDeployments)} degraded, ${String(this.stats.unhealthyDeployments)} unhealthy, ${String(this.stats.stuckDeployments)} stuck deployments detected`,
                    service: 'health-monitor',
                    stage: 'monitoring',
                    metadata: {
                        containerLogs: JSON.stringify({
                            totalDeployments: this.stats.totalDeployments,
                            healthyDeployments: this.stats.healthyDeployments,
                            degradedDeployments: this.stats.degradedDeployments,
                            unhealthyDeployments: this.stats.unhealthyDeployments,
                            stuckDeployments: this.stats.stuckDeployments,
                            restartedContainers: this.stats.restartedContainers,
                            errors: this.stats.errors,
                        }),
                    },
                    timestamp: new Date(),
                });
            }
        } catch (error) {
            this.logger.error('Failed to log monitoring summary:', error);
        }
    }

    /**
     * Get current monitoring statistics
     */
    getMonitoringStats(): MonitoringStats {
        return { ...this.stats };
    }

    /**
     * Check if monitoring is active
     */
    isActivelyMonitoring(): boolean {
        return this.isMonitoring;
    }

    /**
     * Manual health check trigger (for testing or on-demand checks)
     */
    async triggerManualHealthCheck(): Promise<MonitoringStats> {
        this.logger.log('Manual health check triggered');
        await this.performHealthCheck();
        return this.getMonitoringStats();
    }

    /**
     * Public method to check deployment health with optional URL
     * Used by deployment processor for health check jobs
     */
    async checkDeploymentHealthWithUrl(
        deploymentId: string,
        healthCheckUrl?: string,
    ): Promise<{
        healthy: boolean;
        responseTime: number;
        statusCode: number;
        error?: string;
    }> {
        this.logger.log(`Checking health for deployment ${deploymentId} with URL: ${healthCheckUrl ?? 'container-based'}`);

        const startTime = Date.now();

        try {
            // If URL is provided, do an HTTP health check
            if (healthCheckUrl) {
                const response = await fetch(healthCheckUrl, {
                    method: 'GET',
                    signal: AbortSignal.timeout(10000), // 10 second timeout
                });

                const responseTime = Date.now() - startTime;
                const healthy = response.ok;

                return {
                    healthy,
                    responseTime,
                    statusCode: response.status,
                    error: healthy ? undefined : `HTTP ${String(response.status)}: ${response.statusText}`,
                };
            }

            // Otherwise, use container-based health check via DeploymentService
            const healthStatus = await this.deploymentService.monitorDeploymentHealth(deploymentId);
            const responseTime = Date.now() - startTime;

            return {
                healthy: healthStatus.status === 'healthy',
                responseTime,
                statusCode: healthStatus.status === 'healthy' ? 200 : 503,
                error: healthStatus.status !== 'healthy' ? `Status: ${healthStatus.status}` : undefined,
            };
        } catch (error) {
            const err = error as Error;
            const responseTime = Date.now() - startTime;

            this.logger.error(`Health check failed for deployment ${deploymentId}: ${err.message}`);

            return {
                healthy: false,
                responseTime,
                statusCode: 0,
                error: err.message,
            };
        }
    }
}