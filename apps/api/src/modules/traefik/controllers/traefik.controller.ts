import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { TraefikService } from '@/core/modules/traefik/services/traefik.service';
import { TraefikValidationService } from '@/core/modules/traefik/services/traefik-validation.service';
import { TraefikRepository } from '@/core/modules/traefik/repositories/traefik.repository';
import { traefikContract } from '@repo/api-contracts';
@Controller()
export class TraefikController {
    constructor(
        private readonly traefikService: TraefikService,
        private readonly traefikValidationService: TraefikValidationService,
        private readonly traefikRepository: TraefikRepository
    ) { }
    @Implement(traefikContract.forceSyncConfigs)
    forceSyncConfigs() {
        return implement(traefikContract.forceSyncConfigs).handler(async ({ input }) => {
            const { projectName } = input;
            const result = await this.traefikService.forceSyncAll(projectName);
            return result;
        });
    }

    @Implement(traefikContract.cleanupOrphanedFiles)
    cleanupOrphanedFiles() {
        return implement(traefikContract.cleanupOrphanedFiles).handler(async ({ input }) => {
            const { projectName } = input;
            const syncSummary = await this.traefikService.cleanupOrphanedFiles(projectName);
            
            // Transform SyncSummary to match contract expectations
            const cleanedFiles = syncSummary.results
                .filter(result => result.action === 'deleted' && result.success)
                .map(result => result.filePath || result.configName);
            
            return {
                cleanedFiles,
                count: cleanedFiles.length
            };
        });
    }

    // File system endpoints (NEW PROJECT-BASED)
    @Implement(traefikContract.getFileSystem)
    getFileSystem() {
        return implement(traefikContract.getFileSystem).handler(async ({ input }) => {
            const { path } = input;
            return await this.traefikService.getTraefikFileSystem(path);
        });
    }

    @Implement(traefikContract.getProjectFileSystem)
    getProjectFileSystem() {
        return implement(traefikContract.getProjectFileSystem).handler(async ({ input }) => {
            const { projectName } = input;
            return await this.traefikService.getProjectFileSystem(projectName);
        });
    }

    @Implement(traefikContract.getFileContent)
    getFileContent() {
        return implement(traefikContract.getFileContent).handler(async ({ input }) => {
            const { filePath } = input;
            return await this.traefikService.getFileContent(filePath);
        });
    }

    @Implement(traefikContract.downloadFile)
    downloadFile() {
        return implement(traefikContract.downloadFile).handler(async ({ input }) => {
            const { filePath } = input;
            return await this.traefikService.downloadFile(filePath);
        });
    }

    @Implement(traefikContract.listProjects)
    listProjects() {
        return implement(traefikContract.listProjects).handler(async () => {
            const projects = await this.traefikService.listProjects();
            return projects;
        });
    }

    @Implement(traefikContract.validateServiceConfig)
    validateServiceConfig() {
        return implement(traefikContract.validateServiceConfig).handler(async ({ input }) => {
            const { serviceId, configContent } = input;

            // If configContent is provided, validate it directly
            if (configContent) {
                const result = await this.traefikValidationService.validateConfig(configContent);
                return result;
            }

            // Otherwise, fetch the stored config for the service
            const storedConfig = await this.traefikRepository.getServiceConfigByServiceId(serviceId);
            
            if (!storedConfig?.configContent) {
                return {
                    isValid: false,
                    errors: [
                        {
                            path: '',
                            message: 'No Traefik configuration found for this service',
                            code: 'NO_CONFIG'
                        }
                    ]
                };
            }

            const result = await this.traefikValidationService.validateConfig(storedConfig.configContent);
            return result;
        });
    }
}
