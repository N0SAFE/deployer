import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { TraefikService } from '../services/traefik.service';
import { traefikContract } from '@repo/api-contracts';
@Controller()
export class TraefikController {
    constructor(
        private readonly traefikService: TraefikService
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
}
