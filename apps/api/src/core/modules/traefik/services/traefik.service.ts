import { Injectable } from '@nestjs/common';
import { TraefikRepository } from '../repositories/traefik.repository';
import { TraefikFileSystemService } from './traefik-file-system.service';
import { TraefikSyncService } from './traefik-sync.service';

@Injectable()
export class TraefikService {
    constructor(
        private readonly traefikRepository: TraefikRepository,
        private readonly traefikFileSystemService: TraefikFileSystemService,
        private readonly traefikSyncService: TraefikSyncService,
    ) {}

    // ============================================================================
    // DATABASE OPERATIONS (Source of Truth)
    // ============================================================================

    // Service Configuration Management
    async createServiceConfiguration(serviceId: string, config: any) {
        return await this.traefikRepository.createServiceConfig({
            serviceId,
            ...config,
        });
    }

    async getServiceConfiguration(serviceId: string) {
        return await this.traefikRepository.getCompleteServiceConfig(serviceId);
    }

    async updateServiceConfiguration(configId: string, updates: any) {
        return await this.traefikRepository.updateServiceConfig({
            id: configId,
            ...updates,
        });
    }

    async deleteServiceConfiguration(configId: string) {
        return await this.traefikRepository.deleteServiceConfig(configId);
    }

    async getAllServiceConfigurations(isActive?: boolean) {
        return await this.traefikRepository.getAllServiceConfigs(isActive);
    }

    // Domain Route Management
    async addDomainRoute(configId: string, routeConfig: any) {
        return await this.traefikRepository.createDomainRoute({
            configId,
            ...routeConfig,
        });
    }

    async updateDomainRoute(routeId: string, updates: any) {
        return await this.traefikRepository.updateDomainRoute(routeId, updates);
    }

    async deleteDomainRoute(routeId: string) {
        return await this.traefikRepository.deleteDomainRoute(routeId);
    }

    // Service Target Management
    async addServiceTarget(configId: string, targetConfig: any) {
        return await this.traefikRepository.createServiceTarget({
            configId,
            ...targetConfig,
        });
    }

    async updateServiceTarget(targetId: string, updates: any) {
        return await this.traefikRepository.updateServiceTarget(targetId, updates);
    }

    async deleteServiceTarget(targetId: string) {
        return await this.traefikRepository.deleteServiceTarget(targetId);
    }

    // SSL Certificate Management
    async addSSLCertificate(configId: string, certConfig: any) {
        return await this.traefikRepository.createSSLCertificate({
            configId,
            ...certConfig,
        });
    }

    async updateSSLCertificate(certId: string, updates: any) {
        return await this.traefikRepository.updateSSLCertificate(certId, updates);
    }

    async deleteSSLCertificate(certId: string) {
        return await this.traefikRepository.deleteSSLCertificate(certId);
    }

    // Middleware Management
    async createMiddleware(middlewareConfig: any) {
        return await this.traefikRepository.createMiddleware(middlewareConfig);
    }

    async getMiddlewares(serviceId?: string, isGlobal?: boolean) {
        return await this.traefikRepository.getMiddlewares(serviceId, isGlobal, true);
    }

    async updateMiddleware(middlewareId: string, updates: any) {
        return await this.traefikRepository.updateMiddleware(middlewareId, updates);
    }

    async deleteMiddleware(middlewareId: string) {
        return await this.traefikRepository.deleteMiddleware(middlewareId);
    }

    // ============================================================================
    // FILESYSTEM OPERATIONS (Read-Only Access)
    // ============================================================================

    async getTraefikFileSystem(path?: string) {
        return await this.traefikFileSystemService.getTraefikFileSystem(path);
    }

    async getProjectFileSystem(projectName: string) {
        return await this.traefikFileSystemService.getProjectFileSystem(projectName);
    }

    async getFileContent(filePath: string) {
        return await this.traefikFileSystemService.getFileContent(filePath);
    }

    async downloadFile(filePath: string) {
        return await this.traefikFileSystemService.downloadFile(filePath);
    }

    async listProjects() {
        return await this.traefikFileSystemService.listProjects();
    }

    // ============================================================================
    // SYNCHRONIZATION OPERATIONS (Database → Filesystem)
    // ============================================================================

    async syncServiceConfiguration(serviceId: string) {
        const config = await this.traefikRepository.getServiceConfigByServiceId(serviceId);
        if (!config) {
            throw new Error(`Service configuration not found for service ${serviceId}`);
        }
        
        return await this.traefikSyncService.syncServiceConfiguration(config.id);
    }

    async syncAllConfigurations() {
        return await this.traefikSyncService.syncAllConfigurations();
    }

    async forceSyncAll(projectName?: string) {
        // If projectName is provided, sync only that project's configurations
        // Otherwise, sync all configurations for backward compatibility
        const result = projectName 
            ? await this.traefikSyncService.syncProjectConfigurations(projectName)
            : await this.traefikSyncService.syncAllConfigurations();
        
        // Transform to match contract expectations
        return {
            total: result.total,
            successful: result.successful,
            failed: result.failed,
            results: result.results.map(r => ({
                configId: r.configId,
                configName: r.configName,
                success: r.success,
                action: r.action,
                message: r.message,
            }))
        };
    }

    async cleanupOrphanedFiles(projectName?: string) {
        if (projectName) {
            return await this.traefikSyncService.cleanupOrphanedFilesForProject(projectName);
        }
        return await this.traefikSyncService.cleanupOrphanedFiles();
    }

    // ============================================================================
    // HIGH-LEVEL OPERATIONS
    // ============================================================================

    async deployServiceConfiguration(serviceId: string, config: any) {
        // 1. Create or update configuration in database
        const existingConfig = await this.traefikRepository.getServiceConfigByServiceId(serviceId);
        
        let serviceConfig;
        if (existingConfig) {
            serviceConfig = await this.traefikRepository.updateServiceConfig({
                id: existingConfig.id,
                ...config,
            });
        } else {
            serviceConfig = await this.traefikRepository.createServiceConfig({
                serviceId,
                ...config,
            });
        }

        // 2. Sync to filesystem
        const syncResult = await this.traefikSyncService.syncServiceConfiguration(serviceConfig.id);

        return {
            configuration: serviceConfig,
            syncResult,
        };
    }

    async removeServiceConfiguration(serviceId: string) {
        const config = await this.traefikRepository.getServiceConfigByServiceId(serviceId);
        if (!config) {
            throw new Error(`Service configuration not found for service ${serviceId}`);
        }

        // 1. Mark as inactive in database
        await this.traefikRepository.updateServiceConfig({
            id: config.id,
            isActive: false,
        });

        // 2. Clean up filesystem
        await this.traefikSyncService.cleanupOrphanedFiles();

        return { success: true, message: 'Service configuration removed successfully' };
    }

    async getHealthStatus() {
        return await this.traefikRepository.getHealthCheckSummary();
    }

    async validateConfiguration(configId: string) {
        const config = await this.traefikRepository.getCompleteServiceConfig(configId);
        if (!config) {
            throw new Error(`Configuration ${configId} not found`);
        }

        const validation = {
            isValid: true,
            errors: [] as string[],
            warnings: [] as string[],
        };

        // Validate domain
        if (!config.domain) {
            validation.isValid = false;
            validation.errors.push('Domain is required');
        }

        // Validate port
        if (!config.port || config.port < 1 || config.port > 65535) {
            validation.isValid = false;
            validation.errors.push('Valid port number is required (1-65535)');
        }

        // Validate service targets
        if (!config.serviceTargets || config.serviceTargets.length === 0) {
            validation.warnings.push('No service targets configured - will use default localhost target');
        }

        // Validate SSL configuration
        if (config.sslEnabled && (!config.sslProvider || !['letsencrypt', 'selfsigned', 'custom'].includes(config.sslProvider))) {
            validation.errors.push('Valid SSL provider is required when SSL is enabled');
        }

        return validation;
    }
}