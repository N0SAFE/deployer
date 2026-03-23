import { Injectable, Logger } from '@nestjs/common';
import { TraefikRepository } from '../repositories/traefik.repository';
import { TraefikFileSystemService } from './traefik-file-system.service';
import { TraefikSyncService } from './traefik-sync.service';
import { ConfigNotFoundError } from '../errors';

// Import types from centralized interfaces
import type {
  CreateServiceConfigInput,
  UpdateServiceConfigInput,
  CreateDomainRouteInput,
  CreateServiceTargetInput,
  CreateSSLCertificateInput,
  CreateMiddlewareInput,
  SyncSummary,
  ValidationResult,
  ValidationError,
} from '../interfaces';
import type { traefikServiceConfigs } from '@/config/drizzle/schema/traefik';
import type { InferSelectModel } from 'drizzle-orm';

type TraefikServiceConfig = InferSelectModel<typeof traefikServiceConfigs>;

/**
 * Main Traefik service facade
 * Coordinates database operations, filesystem operations, and synchronization
 */
@Injectable()
export class TraefikService {
  private readonly logger = new Logger(TraefikService.name);

  constructor(
    private readonly traefikRepository: TraefikRepository,
    private readonly traefikFileSystemService: TraefikFileSystemService,
    private readonly traefikSyncService: TraefikSyncService,
  ) {}

  // ============================================================================
  // DATABASE OPERATIONS (Source of Truth)
  // ============================================================================

  /**
   * Create a new service configuration
   */
  async createServiceConfiguration(
    serviceId: string,
    config: Omit<CreateServiceConfigInput, 'serviceId'>,
  ) {
    this.logger.debug(`Creating service configuration for service ${serviceId}`);
    return this.traefikRepository.createServiceConfig({
      serviceId,
      ...config,
    });
  }

  /**
   * Get complete service configuration with all related data
   */
  async getServiceConfiguration(configId: string) {
    return this.traefikRepository.getCompleteServiceConfig(configId);
  }

  /**
   * Update an existing service configuration
   */
  async updateServiceConfiguration(
    configId: string,
    updates: Omit<UpdateServiceConfigInput, 'id'>,
  ) {
    this.logger.debug(`Updating service configuration ${configId}`);
    return this.traefikRepository.updateServiceConfig({
      id: configId,
      ...updates,
    });
  }

  /**
   * Delete a service configuration
   */
  async deleteServiceConfiguration(configId: string) {
    this.logger.debug(`Deleting service configuration ${configId}`);
    return this.traefikRepository.deleteServiceConfig(configId);
  }

  /**
   * Get all service configurations
   */
  async getAllServiceConfigurations(isActive?: boolean) {
    return this.traefikRepository.getAllServiceConfigs(isActive);
  }

  // ============================================================================
  // DOMAIN ROUTE MANAGEMENT
  // ============================================================================

  /**
   * Add a domain route to a configuration
   */
  async addDomainRoute(
    configId: string,
    routeConfig: Omit<CreateDomainRouteInput, 'configId'>,
  ) {
    return this.traefikRepository.createDomainRoute({
      configId,
      ...routeConfig,
    });
  }

  /**
   * Update a domain route
   */
  async updateDomainRoute(
    routeId: string,
    updates: Partial<Omit<CreateDomainRouteInput, 'configId'>>,
  ) {
    return this.traefikRepository.updateDomainRoute(routeId, updates);
  }

  /**
   * Delete a domain route
   */
  async deleteDomainRoute(routeId: string) {
    return this.traefikRepository.deleteDomainRoute(routeId);
  }

  // ============================================================================
  // SERVICE TARGET MANAGEMENT
  // ============================================================================

  /**
   * Add a service target to a configuration
   */
  async addServiceTarget(
    configId: string,
    targetConfig: Omit<CreateServiceTargetInput, 'configId'>,
  ) {
    return this.traefikRepository.createServiceTarget({
      configId,
      ...targetConfig,
    });
  }

  /**
   * Update a service target
   */
  async updateServiceTarget(
    targetId: string,
    updates: Partial<Omit<CreateServiceTargetInput, 'configId'>>,
  ) {
    return this.traefikRepository.updateServiceTarget(targetId, updates);
  }

  /**
   * Delete a service target
   */
  async deleteServiceTarget(targetId: string) {
    return this.traefikRepository.deleteServiceTarget(targetId);
  }

  // ============================================================================
  // SSL CERTIFICATE MANAGEMENT
  // ============================================================================

  /**
   * Add an SSL certificate to a configuration
   */
  async addSSLCertificate(
    configId: string,
    certConfig: Omit<CreateSSLCertificateInput, 'configId'>,
  ) {
    return this.traefikRepository.createSSLCertificate({
      configId,
      ...certConfig,
    });
  }

  /**
   * Update an SSL certificate
   */
  async updateSSLCertificate(
    certId: string,
    updates: Partial<Omit<CreateSSLCertificateInput, 'configId'>>,
  ) {
    return this.traefikRepository.updateSSLCertificate(certId, updates);
  }

  /**
   * Delete an SSL certificate
   */
  async deleteSSLCertificate(certId: string) {
    return this.traefikRepository.deleteSSLCertificate(certId);
  }

  // ============================================================================
  // MIDDLEWARE MANAGEMENT
  // ============================================================================

  /**
   * Create a new middleware
   */
  async createMiddleware(middlewareConfig: CreateMiddlewareInput) {
    return this.traefikRepository.createMiddleware(middlewareConfig);
  }

  /**
   * Get middlewares with optional filtering
   */
  async getMiddlewares(serviceId?: string, isGlobal?: boolean) {
    return this.traefikRepository.getMiddlewares(serviceId, isGlobal, true);
  }

  /**
   * Update a middleware
   */
  async updateMiddleware(
    middlewareId: string,
    updates: Partial<Omit<CreateMiddlewareInput, 'serviceId'>>,
  ) {
    return this.traefikRepository.updateMiddleware(middlewareId, updates);
  }

  /**
   * Delete a middleware
   */
  async deleteMiddleware(middlewareId: string) {
    return this.traefikRepository.deleteMiddleware(middlewareId);
  }

  // ============================================================================
  // FILESYSTEM OPERATIONS (Read-Only Access)
  // ============================================================================

  /**
   * Get virtual Traefik filesystem structure
   */
  async getTraefikFileSystem(path?: string) {
    return this.traefikFileSystemService.getTraefikFileSystem(path);
  }

  /**
   * Get virtual filesystem for a specific project
   */
  async getProjectFileSystem(projectName: string) {
    return this.traefikFileSystemService.getProjectFileSystem(projectName);
  }

  /**
   * Get virtual file content
   */
  async getFileContent(filePath: string) {
    return this.traefikFileSystemService.getFileContent(filePath);
  }

  /**
   * Download a file
   */
  async downloadFile(filePath: string) {
    return this.traefikFileSystemService.downloadFile(filePath);
  }

  /**
   * List all projects
   */
  async listProjects() {
    return this.traefikFileSystemService.listProjects();
  }

  // ============================================================================
  // SYNCHRONIZATION OPERATIONS (Database → Filesystem)
  // ============================================================================

  /**
   * Sync a specific service configuration to the filesystem
   */
  async syncServiceConfiguration(serviceId: string) {
    const config = await this.traefikRepository.getServiceConfigByServiceId(serviceId);
    if (!config) {
      throw new ConfigNotFoundError(serviceId, 'service');
    }

    return this.traefikSyncService.syncServiceConfiguration(config.id);
  }

  /**
   * Sync all configurations
   */
  async syncAllConfigurations(): Promise<SyncSummary> {
    return this.traefikSyncService.syncAllConfigurations();
  }

  /**
   * Force sync all configurations (optionally for a specific project)
   */
  async forceSyncAll(projectName?: string): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: {
      configId: string;
      configName: string;
      success: boolean;
      action: string;
      message?: string;
    }[];
  }> {
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
      results: result.results.map((r) => ({
        configId: r.configId,
        configName: r.configName,
        success: r.success,
        action: r.action,
        message: r.message,
      })),
    };
  }

  /**
   * Cleanup orphaned files from the filesystem
   */
  async cleanupOrphanedFiles(projectName?: string): Promise<SyncSummary> {
    if (projectName) {
      return this.traefikSyncService.cleanupOrphanedFilesForProject(projectName);
    }
    return this.traefikSyncService.cleanupOrphanedFiles();
  }

  // ============================================================================
  // HIGH-LEVEL OPERATIONS
  // ============================================================================

  /**
   * Deploy a service configuration (create/update + sync)
   */
  async deployServiceConfiguration(
    serviceId: string,
    config: Omit<CreateServiceConfigInput, 'serviceId'>,
  ) {
    this.logger.log(`Deploying service configuration for ${serviceId}`);

    // 1. Create or update configuration in database
    const existingConfig = await this.traefikRepository.getServiceConfigByServiceId(serviceId);

    let serviceConfig: TraefikServiceConfig | null = null;
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
    const configIdToSync = typeof serviceConfig === 'object' && serviceConfig !== null && 'id' in serviceConfig
      ? serviceConfig.id
      : '';
    const syncResult = await this.traefikSyncService.syncServiceConfiguration(configIdToSync);

    this.logger.log(`Service configuration deployed for ${serviceId}: ${syncResult.success ? 'success' : 'failed'}`);

    return {
      configuration: serviceConfig,
      syncResult,
    };
  }

  /**
   * Remove a service configuration
   */
  async removeServiceConfiguration(serviceId: string) {
    this.logger.log(`Removing service configuration for ${serviceId}`);

    const config = await this.traefikRepository.getServiceConfigByServiceId(serviceId);
    if (!config) {
      throw new ConfigNotFoundError(serviceId, 'service');
    }

    // 1. Mark as inactive in database
    await this.traefikRepository.updateServiceConfig({
      id: config.id,
      isActive: false,
    });

    // 2. Clean up filesystem
    await this.traefikSyncService.cleanupOrphanedFiles();

    this.logger.log(`Service configuration removed for ${serviceId}`);

    return { success: true, message: 'Service configuration removed successfully' };
  }

  /**
   * Get health status of Traefik configurations
   */
  async getHealthStatus() {
    return this.traefikRepository.getHealthCheckSummary();
  }

  /**
   * Validate a configuration
   */
  async validateConfiguration(configId: string): Promise<ValidationResult> {
    const config = await this.traefikRepository.getCompleteServiceConfig(configId);
    if (!config) {
      throw new ConfigNotFoundError(configId, 'configuration');
    }

    const errors: ValidationError[] = [];
    const warnings: { path: string; message: string }[] = [];

    // Validate domain
    if (!config.domain) {
      errors.push({
        path: 'domain',
        message: 'Domain is required',
        code: 'MISSING_DOMAIN',
      });
    }

    // Validate port
    if (!config.port || config.port < 1 || config.port > 65535) {
      errors.push({
        path: 'port',
        message: 'Valid port number is required (1-65535)',
        code: 'INVALID_PORT',
      });
    }

    // Validate service targets
    const serviceTargets = config.serviceTargets as unknown[] | undefined;
    if (!serviceTargets || serviceTargets.length === 0) {
      warnings.push({
        path: 'serviceTargets',
        message: 'No service targets configured - will use default localhost target',
      });
    }

    // Validate SSL configuration
    const validSslProviders = ['letsencrypt', 'selfsigned', 'custom'];
    if (config.sslEnabled && (!config.sslProvider || !validSslProviders.includes(config.sslProvider))) {
      errors.push({
        path: 'sslProvider',
        message: 'Valid SSL provider is required when SSL is enabled',
        code: 'INVALID_SSL_PROVIDER',
      });
    }

    const result: ValidationResult = {
      isValid: errors.length === 0,
      errors,
      warnings,
    };

    // Log validation failures
    if (!result.isValid) {
      this.logger.warn(`Configuration ${configId} validation failed with ${String(errors.length)} error(s)`);
    }

    return result;
  }
}