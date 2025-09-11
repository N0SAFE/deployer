import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DeploymentService } from './deployment.service';
import { DockerService } from './docker.service';
import { db } from '../modules/db/drizzle/index';
import { deployments, deploymentLogs } from '../modules/db/drizzle/schema';
import { inArray } from 'drizzle-orm';

/**
 * Deployment Health Monitor Service
 * 
 * Continuously monitors the health of all active deployments and updates their status.
 * Features:
 * - Periodic health checks every 2 minutes
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
    restartedContainers: number;
    errors: number;
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
        restartedContainers: 0,
        errors: 0,
    };

    constructor(
        private readonly deploymentService: DeploymentService,
        private readonly dockerService: DockerService,
    ) {}

    async onApplicationBootstrap() {
        this.logger.log('Deployment Health Monitor Service starting...');
        this.isMonitoring = true;
        
        // Run initial health check after a short delay to allow other services to start
        setTimeout(() => {
            this.performHealthCheck().catch(error => {
                this.logger.error('Initial health check failed:', error);
            });
        }, 30000); // 30 seconds delay
    }

    async onApplicationShutdown() {
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
                restartedContainers: 0,
                errors: 0,
            };

            // Get all active deployments (successful or deployed)
            const activeDeployments = await db
                .select()
                .from(deployments)
                .where(inArray(deployments.status, ['success', 'deploying']));

            this.stats.totalDeployments = activeDeployments.length;

            if (activeDeployments.length === 0) {
                this.logger.log('No active deployments to monitor');
                return;
            }

            this.logger.log(`Monitoring ${activeDeployments.length} active deployments`);

            // Check each deployment
            const healthPromises = activeDeployments.map(deployment => 
                this.checkDeploymentHealth(deployment.id)
            );

            await Promise.allSettled(healthPromises);

            const duration = Date.now() - startTime;
            this.logger.log(
                `Health check completed in ${duration}ms - ` +
                `${this.stats.healthyDeployments} healthy, ` +
                `${this.stats.degradedDeployments} degraded, ` +
                `${this.stats.unhealthyDeployments} unhealthy, ` +
                `${this.stats.restartedContainers} containers restarted, ` +
                `${this.stats.errors} errors`
            );

            // Log summary if there are issues
            if (this.stats.degradedDeployments > 0 || this.stats.unhealthyDeployments > 0) {
                await this.logMonitoringSummary();
            }

        } catch (error) {
            this.logger.error('Health check failed:', error);
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
                    `Successfully restarted ${restartResult.restartedContainers.length} containers ` +
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
    private async logRestartAction(deploymentId: string, restartResult: any): Promise<void> {
        try {
            await db.insert(deploymentLogs).values({
                deploymentId,
                level: 'info',
                message: `Automatic restart: ${restartResult.restartedContainers.length} containers restarted`,
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
            const recentDeployments = await db
                .select()
                .from(deployments)
                .where(inArray(deployments.status, ['success', 'deploying']))
                .limit(1);

            if (recentDeployments.length > 0) {
                await db.insert(deploymentLogs).values({
                    deploymentId: recentDeployments[0].id,
                    level: 'warn',
                    message: `Health monitoring summary: ${this.stats.degradedDeployments} degraded, ${this.stats.unhealthyDeployments} unhealthy deployments detected`,
                    service: 'health-monitor',
                    stage: 'monitoring',
                    metadata: {
                        containerLogs: JSON.stringify({
                            totalDeployments: this.stats.totalDeployments,
                            healthyDeployments: this.stats.healthyDeployments,
                            degradedDeployments: this.stats.degradedDeployments,
                            unhealthyDeployments: this.stats.unhealthyDeployments,
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
}