import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { oc } from '@orpc/contract';
import { z } from 'zod';
import { DeploymentHealthMonitorService } from '../../../core/modules/deployment/services/deployment-health-monitor.service';

/**
 * Health Monitor API Contract
 */
const healthMonitorContract = oc.tag("HealthMonitor").prefix("/monitor").router({
    status: oc
        .route({
            method: 'GET',
            path: '/status',
            summary: 'Get health monitoring service status',
        })
        .input(z.object({}))
        .output(z.object({
            isActive: z.boolean(),
            stats: z.object({
                totalDeployments: z.number(),
                healthyDeployments: z.number(),
                degradedDeployments: z.number(),
                unhealthyDeployments: z.number(),
                restartedContainers: z.number(),
                errors: z.number(),
            }),
        })),
    
    trigger: oc
        .route({
            method: 'POST',
            path: '/trigger',
            summary: 'Manually trigger health check',
        })
        .input(z.object({}))
        .output(z.object({
            success: z.boolean(),
            message: z.string(),
            stats: z.object({
                totalDeployments: z.number(),
                healthyDeployments: z.number(),
                degradedDeployments: z.number(),
                unhealthyDeployments: z.number(),
                restartedContainers: z.number(),
                errors: z.number(),
            }),
        })),
});

@Controller()
export class HealthMonitorController {
    private readonly logger = new Logger(HealthMonitorController.name);

    constructor(
        private readonly healthMonitorService: DeploymentHealthMonitorService,
    ) {}

    @Implement(healthMonitorContract.status)
    getStatus() {
        return implement(healthMonitorContract.status).handler(async ({ input: _input }) => {
            this.logger.log('Getting health monitoring status');
            
            try {
                const isActive = this.healthMonitorService.isActivelyMonitoring();
                const stats = this.healthMonitorService.getMonitoringStats();
                
                return {
                    isActive,
                    stats,
                };
            }
            catch (error) {
                this.logger.error('Error getting health monitoring status:', error);
                throw error;
            }
        });
    }

    @Implement(healthMonitorContract.trigger)
    triggerHealthCheck() {
        return implement(healthMonitorContract.trigger).handler(async ({ input: _input }) => {
            this.logger.log('Manual health check triggered via API');
            
            try {
                const stats = await this.healthMonitorService.triggerManualHealthCheck();
                
                return {
                    success: true,
                    message: 'Health check completed successfully',
                    stats,
                };
            }
            catch (error) {
                this.logger.error('Error triggering manual health check:', error);
                return {
                    success: false,
                    message: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    stats: this.healthMonitorService.getMonitoringStats(),
                };
            }
        });
    }
}

export { healthMonitorContract };