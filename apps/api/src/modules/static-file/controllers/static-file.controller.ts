import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { StaticFileService } from '../../../core/services/static-file.service';
import { staticFileContract } from '@repo/api-contracts';
@Controller()
export class StaticFileController {
    private readonly logger = new Logger(StaticFileController.name);
    constructor(private readonly staticFileService: StaticFileService) { }
    /**
     * Deploy static files with nginx container
     * POST /static-file/deploy
     */
    @Implement(staticFileContract.deploy)
    async deployStaticFiles() {
        return implement(staticFileContract.deploy).handler(async ({ input }) => {
            try {
                this.logger.log(`Deploying static files for service: ${input.serviceName}`);
                const containerInfo = await this.staticFileService.deployStaticFiles(input);
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
     * PUT /static-file/:serviceName
     */
    @Implement(staticFileContract.update)
    async updateStaticFiles() {
        return implement(staticFileContract.update).handler(async ({ input }) => {
            try {
                this.logger.log(`Updating static files for service: ${input.serviceName}`);
                await this.staticFileService.updateStaticFiles(input.containerName, input.filesPath, input.customNginxConfig);
                return {
                    success: true,
                };
            }
            catch (error) {
                this.logger.error(`Failed to update static files for ${input.serviceName}:`, error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error occurred',
                };
            }
        });
    }
    /**
     * Remove static file deployment
     * DELETE /static-file/:serviceName/:containerName
     */
    @Implement(staticFileContract.remove)
    async removeStaticFileDeployment() {
        return implement(staticFileContract.remove).handler(async ({ input }) => {
            try {
                this.logger.log(`Removing static file deployment for service: ${input.serviceName}`);
                await this.staticFileService.removeStaticFileDeployment(input.serviceName, input.containerName);
                return {
                    success: true,
                };
            }
            catch (error) {
                this.logger.error(`Failed to remove static file deployment for ${input.serviceName}:`, error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error occurred',
                };
            }
        });
    }
}
