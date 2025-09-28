import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { StaticFileService } from '../../../core/services/static-file.service';
import { staticFileContract } from '@repo/api-contracts';
@Controller()
export class StaticFileController {
    private readonly logger = new Logger(StaticFileController.name);
    constructor(private readonly staticFileService: StaticFileService) { }
    /**
     * Deploy static files using project-level HTTP server
     * POST /static-file/deploy
     */
    @Implement(staticFileContract.deploy)
    async deployStaticFiles() {
        return implement(staticFileContract.deploy).handler(async ({ input }) => {
            try {
                this.logger.log(`Deploying static files for serviceId: ${input.serviceId}`);
                const containerInfo = await this.staticFileService.deployStaticFiles({
                    serviceName: input.serviceId,
                    deploymentId: input.deploymentId,
                    projectId: input.projectId,
                    domain: input.domain || 'localhost',
                    subdomain: input.subdomain,
                    sourcePath: input.sourcePath,
                } as any);
                return {
                    success: true,
                    containerInfo,
                };
            }
            catch (error) {
                this.logger.error('Failed to deploy static files:', error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error occurred',
                };
            }
        });
    }
    /**
     * Update existing static file deployment
     * PUT /static-file/update
     */
    @Implement(staticFileContract.update)
    async updateStaticFiles() {
        return implement(staticFileContract.update).handler(async ({ input }) => {
            try {
                this.logger.log(`Updating static files for serviceId: ${input.serviceId}`);
                const projectId = input.projectId || process.env.COMPOSE_PROJECT_NAME || 'project';
                await this.staticFileService.updateStaticFiles(projectId, input.serviceId, input.deploymentId, input.sourcePath);
                return {
                    success: true,
                };
            }
            catch (error) {
                this.logger.error(`Failed to update static files for ${input.serviceId}:`, error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error occurred',
                };
            }
        });
    }
    /**
     * Remove static file deployment
     * DELETE /static-file/remove
     */
    @Implement(staticFileContract.remove)
    async removeStaticFileDeployment() {
        return implement(staticFileContract.remove).handler(async ({ input }) => {
            try {
                this.logger.log(`Removing static file deployment for serviceId: ${input.serviceId}`);
                const projectId = input.projectId || process.env.COMPOSE_PROJECT_NAME || 'project';
                await this.staticFileService.removeStaticFileDeployment(projectId, input.serviceId, input.deploymentId || undefined);
                return {
                    success: true,
                };
            }
            catch (error) {
                this.logger.error(`Failed to remove static file deployment for ${input.serviceId}:`, error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error occurred',
                };
            }
        });
    }
}
