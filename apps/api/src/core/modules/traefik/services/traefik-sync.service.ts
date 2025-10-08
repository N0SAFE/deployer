import { Injectable, Logger } from '@nestjs/common';
import * as yaml from 'yaml';
import * as fs from 'fs';
import * as path from 'path';
import { TraefikRepository } from '../repositories/traefik.repository';
import { TraefikFileSystemService } from './traefik-file-system.service';

export interface SyncResult {
  configId: string;
  configName: string;
  success: boolean;
  action: 'created' | 'updated' | 'deleted' | 'skipped' | 'error';
  message: string;
  filePath?: string;
}

export interface SyncSummary {
  total: number;
  successful: number;
  failed: number;
  results: SyncResult[];
}

@Injectable()
export class TraefikSyncService {
  private readonly logger = new Logger(TraefikSyncService.name);

  constructor(
    private readonly traefikRepository: TraefikRepository,
    private readonly traefikFileSystemService: TraefikFileSystemService,
  ) {}

  // ============================================================================
  // MAIN SYNC OPERATIONS
  // ============================================================================

  async syncAllConfigurations(): Promise<SyncSummary> {
    this.logger.log('Starting optimized sync of Traefik configurations that need syncing');

    // Get only configs that need syncing (optimized)
    const configs = await this.traefikRepository.getTraefikConfigsNeedingSync(true);
    
    this.logger.debug(`Found ${configs.length} configurations that need syncing`);
    
    const results: SyncResult[] = [];

    for (const config of configs) {
      try {
        const result = await this.syncTraefikConfigData(config);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to sync config ${config.id}:`, error);
        
        // Mark sync as failed in database
        await this.traefikRepository.markTraefikConfigSyncFailed(
          config.id, 
          error instanceof Error ? error.message : 'Unknown error'
        );
        
        results.push({
          configId: config.id,
          configName: config.configName || config.configType,
          success: false,
          action: 'error',
          message: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    const summary = this.generateSyncSummary(results);
    this.logger.log(`Optimized sync completed: ${summary.successful}/${summary.total} successful`);
    
    return summary;
  }

  /**
   * Sync a Traefik configuration using the data provided (optimized for batch sync)
   */
  async syncTraefikConfigData(config: any): Promise<SyncResult> {
    this.logger.debug(`Syncing Traefik configuration ${config.id}`);

    try {
      // Use the stored configuration content
      const configContent = config.configContent;
      
      // Always generate file path dynamically from UUID and record data
      const fileName = `${config.configType}-${config.id}.yaml`;
      let relativePathFromBase: string;
      
      if (config.storageType === 'project' && config.projectName) {
        relativePathFromBase = `dynamic/projects/${config.projectName}/${fileName}`;
      } else {
        // Standalone configs go to dynamic/standalone/
        relativePathFromBase = `dynamic/standalone/${fileName}`;
      }      // Write configuration to real filesystem
      await this.writeRealFile(relativePathFromBase, configContent);

      // Update sync status in the database
      await this.traefikRepository.updateTraefikConfigSyncStatus(config.id, new Date());

      return {
        configId: config.id,
        configName: config.configName,
        success: true,
        action: 'updated',
        message: `Configuration synced to ${relativePathFromBase}`,
        filePath: relativePathFromBase,
      };
    } catch (error) {
      this.logger.error(`Failed to sync Traefik configuration ${config.id}:`, error);
      
      // Mark sync as failed
      await this.traefikRepository.markTraefikConfigSyncFailed(
        config.id, 
        error instanceof Error ? error.message : 'Unknown error'
      );

      return {
        configId: config.id,
        configName: config.configName,
        success: false,
        action: 'error',
        message: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async syncTraefikConfigurationById(configId: string): Promise<SyncResult> {
    this.logger.debug(`Syncing Traefik configuration ${configId}`);

    // Get Traefik configuration from the new table
    const config = await this.traefikRepository.getTraefikConfigById(configId);
    if (!config) {
      return {
        configId,
        configName: 'unknown',
        success: false,
        action: 'error',
        message: 'Traefik configuration not found in database',
      };
    }

    try {
      // Use the stored configuration content
      const configContent = config.configContent;
      
      // Always generate file path dynamically from UUID and record data
      let projectName: string | null = null;
      if (config.projectId) {
        const project = await this.traefikRepository.getProjectById(config.projectId);
        projectName = project?.name || null;
      }
        
      // Generate path using naming conventions with project name, not ID
      const fileName = `${config.configType}-${config.id}.yaml`;
      let relativePathFromBase: string;
      
      if (config.storageType === 'project' && projectName) {
        relativePathFromBase = `dynamic/projects/${projectName}/${fileName}`;
      } else {
        // Standalone configs go to dynamic/standalone/
        relativePathFromBase = `dynamic/standalone/${fileName}`;
      }

      // Write configuration to real filesystem
      await this.writeRealFile(relativePathFromBase, configContent);

      // Update sync status in the new table
      await this.traefikRepository.updateTraefikConfigSyncStatus(configId, new Date());

      return {
        configId,
        configName: config.configName,
        success: true,
        action: 'updated',
        message: `Traefik configuration synced successfully to ${relativePathFromBase}`,
        filePath: relativePathFromBase,
      };
    } catch (error) {
      this.logger.error(`Failed to sync Traefik configuration ${configId}:`, error);
      
      // Mark as failed
      await this.traefikRepository.markTraefikConfigSyncFailed(
        configId, 
        error instanceof Error ? error.message : 'Unknown error'
      );
      
      return {
        configId,
        configName: config.configName,
        success: false,
        action: 'error',
        message: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async syncServiceConfiguration(configId: string): Promise<SyncResult> {
    this.logger.debug(`Syncing configuration ${configId}`);

    // Get complete configuration from database
    const completeConfig = await this.traefikRepository.getCompleteServiceConfig(configId);
    if (!completeConfig) {
      return {
        configId,
        configName: 'unknown',
        success: false,
        action: 'error',
        message: 'Configuration not found in database',
      };
    }

    try {
      // Generate Traefik configuration content
      const traefikConfig = await this.generateTraefikConfiguration(completeConfig);
      const configContent = yaml.stringify(traefikConfig);
      
      // Use filesystem service to determine file path and naming
      const projectName = await this.getProjectName(completeConfig.serviceId);
      const relativePath = this.traefikFileSystemService.generateServiceConfigPath(
        completeConfig.serviceId,
        completeConfig.id,
        projectName
      );
      
      // Remove base path to get relative path for writeRealFile
      const paths = this.traefikFileSystemService.getFileSystemPaths();
      const relativePathFromBase = relativePath.replace(paths.basePath + '/', '');

      // Write configuration to real filesystem (not virtual)
      await this.writeRealFile(relativePathFromBase, configContent);

      // Update database with sync status
      await this.traefikRepository.updateConfigSyncStatus(configId, new Date());

      // Update or create config file record
      const fileName = this.traefikFileSystemService.generateServiceConfigFileName(
        completeConfig.serviceId,
        completeConfig.id
      );
      await this.updateConfigFileRecord(configId, fileName, relativePath, configContent, relativePathFromBase);

      return {
        configId,
        configName: completeConfig.fullDomain,
        success: true,
        action: 'created',
        message: `Configuration synced successfully to ${relativePathFromBase}`,
        filePath: relativePath,
      };
    } catch (error) {
      this.logger.error(`Failed to sync configuration ${configId}:`, error);
      return {
        configId,
        configName: completeConfig.fullDomain,
        success: false,
        action: 'error',
        message: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async syncProjectConfigurations(projectId: string): Promise<SyncSummary> {
    this.logger.log(`Starting optimized sync for project ${projectId} (only changed configs)`);

    // Get only configs that need syncing for this project (optimized)
    const configs = await this.traefikRepository.getTraefikConfigsNeedingSyncByProject(projectId, true);

    this.logger.debug(`Found ${configs.length} configurations that need syncing for project ${projectId}`);

    const results: SyncResult[] = [];
    for (const config of configs) {
      try {
        const result = await this.syncTraefikConfigData(config);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to sync config ${config.id}:`, error);
        
        // Mark sync as failed in database
        await this.traefikRepository.markTraefikConfigSyncFailed(
          config.id, 
          error instanceof Error ? error.message : 'Unknown error'
        );
        
        results.push({
          configId: config.id,
          configName: config.configName || config.configType,
          success: false,
          action: 'error',
          message: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    const summary = this.generateSyncSummary(results);
    this.logger.log(`Project ${projectId} optimized sync completed: ${summary.successful}/${summary.total} successful`);
    
    return summary;
  }

  async syncStandaloneConfigurations(): Promise<SyncSummary> {
    this.logger.log('Starting optimized sync for standalone configurations (only changed configs)');

    // Get only standalone configs that need syncing (optimized)
    const configs = await this.traefikRepository.getStandaloneTraefikConfigsNeedingSync(true);

    this.logger.debug(`Found ${configs.length} standalone configurations that need syncing`);

    const results: SyncResult[] = [];
    for (const config of configs) {
      try {
        const result = await this.syncTraefikConfigData(config);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to sync standalone config ${config.id}:`, error);
        
        // Mark sync as failed in database
        await this.traefikRepository.markTraefikConfigSyncFailed(
          config.id, 
          error instanceof Error ? error.message : 'Unknown error'
        );
        
        results.push({
          configId: config.id,
          configName: config.configName || config.configType,
          success: false,
          action: 'error',
          message: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    const summary = this.generateSyncSummary(results);
    this.logger.log(`Standalone optimized sync completed: ${summary.successful}/${summary.total} successful`);
    
    return summary;
  }

  async deleteConfigurationFile(configId: string): Promise<SyncResult> {
    this.logger.debug(`Deleting configuration file for ${configId}`);

    try {
      // Get configuration from database to determine file path
      const completeConfig = await this.traefikRepository.getCompleteServiceConfig(configId);
      if (!completeConfig) {
        return {
          configId,
          configName: 'unknown',
          success: false,
          action: 'error',
          message: 'Configuration not found in database',
        };
      }

      // Determine file path using filesystem service
      const projectName = await this.getProjectName(completeConfig.serviceId);
      const relativePath = this.traefikFileSystemService.generateServiceConfigPath(
        completeConfig.serviceId,
        completeConfig.id,
        projectName
      );
      
      // Remove base path to get relative path for deleteFile
      const paths = this.traefikFileSystemService.getFileSystemPaths();
      const relativePathFromBase = relativePath.replace(paths.basePath + '/', '');

      // Delete REAL file only (not virtual)
      const deleteResult = await this.deleteRealFile(relativePathFromBase);
      
      if (deleteResult.success) {
        // Remove config file record from database
        await this.traefikRepository.deleteConfigFile(configId);
      }

      return {
        configId,
        configName: completeConfig.fullDomain,
        success: deleteResult.success,
        action: 'deleted',
        message: deleteResult.success ? 'Configuration file deleted successfully' : (deleteResult.message || 'Failed to delete file'),
        filePath: relativePath,
      };
    } catch (error) {
      this.logger.error(`Failed to delete configuration file for ${configId}:`, error);
      return {
        configId,
        configName: 'unknown',
        success: false,
        action: 'error',
        message: `Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // ============================================================================
  // CONFIGURATION GENERATION
  // ============================================================================

  async generateTraefikConfiguration(completeConfig: any): Promise<any> {
    this.logger.debug(`Generating Traefik configuration for ${completeConfig.fullDomain}`);

    // Build basic service configuration
    const traefikConfig: any = {
      http: {
        services: {},
        routers: {},
      },
    };

    // Add service definition
    const serviceName = `service-${completeConfig.serviceId.slice(0, 8)}`;
    traefikConfig.http.services[serviceName] = {
      loadBalancer: {
        servers: [
          {
            url: `http://${completeConfig.serviceHost}:${completeConfig.servicePort}`,
          },
        ],
      },
    };

    // Add router configuration for each domain route
    for (const domainRoute of completeConfig.domainRoutes || []) {
      const routerName = `router-${domainRoute.id.slice(0, 8)}`;
      
      traefikConfig.http.routers[routerName] = {
        rule: `Host(\`${domainRoute.fullDomain}\`)`,
        service: serviceName,
        entryPoints: ['web', 'websecure'],
      };

      // Add middlewares if they exist
      const middlewares: string[] = [];
      
      // Add SSL middleware if certificate exists
      if (domainRoute.sslCertificate) {
        middlewares.push('tls-cert');
        traefikConfig.http.routers[routerName].tls = {
          certResolver: domainRoute.sslCertificate.resolverName || 'letsencrypt',
        };
      }

      // Add custom middlewares
      if (completeConfig.middlewares && completeConfig.middlewares.length > 0) {
        for (const middleware of completeConfig.middlewares) {
          middlewares.push(`middleware-${middleware.id.slice(0, 8)}`);
          
          // Add middleware definition
          if (!traefikConfig.http.middlewares) {
            traefikConfig.http.middlewares = {};
          }
          
          traefikConfig.http.middlewares[`middleware-${middleware.id.slice(0, 8)}`] = this.parseMiddlewareConfiguration(middleware);
        }
      }

      if (middlewares.length > 0) {
        traefikConfig.http.routers[routerName].middlewares = middlewares;
      }
    }

    return traefikConfig;
  }

  private parseMiddlewareConfiguration(middleware: any): any {
    try {
      // Handle cases where configuration might be null, undefined, or the string "undefined"
      if (!middleware.configuration || middleware.configuration === 'undefined' || middleware.configuration === null) {
        this.logger.warn(`Middleware ${middleware.id} has invalid configuration, using fallback`);
        return {
          headers: {
            customRequestHeaders: {
              'X-Custom-Header': 'Generated by Traefik Manager',
            },
          },
        };
      }

      // If configuration is already an object, return it directly
      if (typeof middleware.configuration === 'object') {
        return middleware.configuration;
      }

      // If it's a string, try to parse it as JSON
      return JSON.parse(middleware.configuration);
    } catch (error) {
      this.logger.warn(`Failed to parse middleware configuration for ${middleware.id}:`, error);
      this.logger.warn(`Configuration value was:`, middleware.configuration);
      return {
        headers: {
          customRequestHeaders: {
            'X-Custom-Header': 'Generated by Traefik Manager',
          },
        },
      };
    }
  }

  // ============================================================================
  // CLEANUP OPERATIONS  
  // ============================================================================

  async cleanupOrphanedFiles(): Promise<SyncSummary> {
    this.logger.log('Starting cleanup of orphaned configuration files');

    try {
      // Get all configuration files from filesystem
      const allConfigFiles = await this.traefikFileSystemService.getAllConfigFiles();
      
      // Get all active configurations from database
      const activeConfigs = await this.traefikRepository.getAllServiceConfigs(true);
      const activeConfigIds = new Set(activeConfigs.map(config => config.id));

      const results: SyncResult[] = [];

      for (const filePath of allConfigFiles) {
        try {
          // Parse config ID from filename using filesystem service
          const fileName = filePath.split('/').pop() || '';
          const parsedInfo = this.traefikFileSystemService.parseServiceConfigFileName(fileName);
          
          if (!parsedInfo) {
            this.logger.debug(`Skipping file with unrecognized format: ${fileName}`);
            continue;
          }

          // Check if configuration still exists in database
          const configExists = activeConfigIds.has(parsedInfo.configId);
          
          if (!configExists) {
            // File is orphaned, delete REAL file only (not virtual)
            const paths = this.traefikFileSystemService.getFileSystemPaths();
            const relativePathFromBase = filePath.replace(paths.basePath + '/', '');
            
            const deleteResult = await this.deleteRealFile(relativePathFromBase);
            
            results.push({
              configId: parsedInfo.configId,
              configName: fileName,
              success: deleteResult.success,
              action: 'deleted',
              message: deleteResult.success ? 'Orphaned real file deleted' : (deleteResult.message || 'Failed to delete orphaned file'),
              filePath,
            });
            
            this.logger.debug(`Cleaned up orphaned file: ${filePath}`);
          }
        } catch (error) {
          this.logger.error(`Failed to process file ${filePath}:`, error);
          results.push({
            configId: 'unknown',
            configName: filePath,
            success: false,
            action: 'error',
            message: `Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            filePath,
          });
        }
      }

      const summary = this.generateSyncSummary(results);
      this.logger.log(`Cleanup completed: ${summary.successful} files processed, ${results.filter(r => r.action === 'deleted').length} orphaned files removed`);
      
      return summary;
    } catch (error) {
      this.logger.error('Failed to cleanup orphaned files:', error);
      throw new Error(`Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async cleanupOrphanedFilesForProject(projectId: string): Promise<SyncSummary> {
    this.logger.log(`Starting cleanup of orphaned configuration files for project ${projectId}`);

    try {
      // Get all configuration files from filesystem
      const allConfigFiles = await this.traefikFileSystemService.getAllConfigFiles();
      
      // Get active configurations for this specific project
      const activeConfigs = await this.traefikRepository.getServiceConfigsByProject(projectId, true);
      const activeConfigIds = new Set(activeConfigs.map(config => config.id));

      const results: SyncResult[] = [];

      for (const filePath of allConfigFiles) {
        try {
          // Parse config ID from filename using filesystem service
          const fileName = filePath.split('/').pop() || '';
          const parsedInfo = this.traefikFileSystemService.parseServiceConfigFileName(fileName);
          
          if (!parsedInfo) {
            this.logger.debug(`Skipping file with unrecognized format: ${fileName}`);
            continue;
          }

          // Get the configuration from database to check if it belongs to this project
          const config = await this.traefikRepository.getServiceConfig(parsedInfo.configId);
          if (!config) {
            // Config doesn't exist at all - it's orphaned, delete REAL file only
            const paths = this.traefikFileSystemService.getFileSystemPaths();
            const relativePathFromBase = filePath.replace(paths.basePath + '/', '');
            
            const deleteResult = await this.deleteRealFile(relativePathFromBase);
            
            results.push({
              configId: parsedInfo.configId,
              configName: fileName,
              success: deleteResult.success,
              action: 'deleted',
              message: deleteResult.success ? 'Orphaned real file deleted (config not found)' : (deleteResult.message || 'Failed to delete orphaned file'),
              filePath,
            });
            continue;
          }

          // Check if this config belongs to the specified project
          const service = await this.traefikRepository.getServiceById(config.serviceId);
          if (!service || service.projectId !== projectId) {
            // This file doesn't belong to the specified project, skip it
            continue;
          }

          // Check if configuration is still active for this project
          const configExists = activeConfigIds.has(parsedInfo.configId);
          
          if (!configExists) {
            // File is orphaned for this project, delete REAL file only
            const paths = this.traefikFileSystemService.getFileSystemPaths();
            const relativePathFromBase = filePath.replace(paths.basePath + '/', '');
            
            const deleteResult = await this.deleteRealFile(relativePathFromBase);
            
            results.push({
              configId: parsedInfo.configId,
              configName: fileName,
              success: deleteResult.success,
              action: 'deleted',
              message: deleteResult.success ? 'Orphaned real file deleted (inactive config)' : (deleteResult.message || 'Failed to delete orphaned file'),
              filePath,
            });
          } else {
            // File is still active for this project
            results.push({
              configId: parsedInfo.configId,
              configName: fileName,
              success: true,
              action: 'skipped',
              message: 'Active configuration file kept',
              filePath,
            });
          }
        } catch (error) {
          this.logger.error(`Failed to process file ${filePath}:`, error);
          results.push({
            configId: 'unknown',
            configName: filePath.split('/').pop() || 'unknown',
            success: false,
            action: 'error',
            message: `Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            filePath,
          });
        }
      }

      const summary = this.generateSyncSummary(results);
      this.logger.log(`Project ${projectId} cleanup completed: ${summary.successful} files processed, ${results.filter(r => r.action === 'deleted').length} orphaned files removed`);
      
      return summary;
    } catch (error) {
      this.logger.error(`Failed to cleanup orphaned files for project ${projectId}:`, error);
      throw new Error(`Project cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Get project name for a service
   */
  private async getProjectName(serviceId: string): Promise<string | undefined> {
    // Get service info from database to determine project
    try {
      // First, get the service to find its project ID
      const service = await this.traefikRepository.getServiceById(serviceId);
      if (!service) {
        this.logger.warn(`Service ${serviceId} not found`);
        return undefined;
      }

      // Then get the project to get its name
      const project = await this.traefikRepository.getProjectById(service.projectId);
      if (!project) {
        this.logger.warn(`Project ${service.projectId} not found for service ${serviceId}`);
        return undefined;
      }

      return project.name;
    } catch (error) {
      this.logger.warn(`Failed to get project name for service ${serviceId}:`, error);
      return undefined;
    }
  }

  private async updateConfigFileRecord(
    configId: string,
    fileName: string,
    filePath: string,
    content: string,
    relativePath: string
  ): Promise<void> {
    try {
      // Calculate content checksum using filesystem service
      const checksum = this.traefikFileSystemService.calculateChecksum(content);
      
      await this.traefikRepository.createConfigFile({
        configId: configId,
        fileName,
        filePath,
        relativePath: relativePath,
        fileType: 'traefik',
        contentType: 'application/x-yaml',
        size: content.length,
        checksum,
        content,
        isActive: true,
      });
    } catch (error) {
      this.logger.error(`Failed to update config file record for ${configId}:`, error);
      // Don't throw here as the file sync was successful
    }
  }

  private generateSyncSummary(results: SyncResult[]): SyncSummary {
    return {
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    };
  }

  // ============================================================================
  // REAL FILESYSTEM OPERATIONS
  // ============================================================================

  /**
   * Write content to the real filesystem (not virtual)
   * This is used during sync operations to create actual files that Traefik can read
   */
  private async writeRealFile(filePath: string, content: string): Promise<void> {
    try {
      const paths = this.traefikFileSystemService.getFileSystemPaths();
      const fullPath = path.join(paths.basePath, filePath);
      
      // Ensure directory exists
      const dir = path.dirname(fullPath);
      await fs.promises.mkdir(dir, { recursive: true });
      
      // Write the file
      await fs.promises.writeFile(fullPath, content, 'utf8');
      this.logger.debug(`Successfully wrote real file: ${fullPath}`);
    } catch (error) {
      this.logger.error(`Failed to write real file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Delete real file from filesystem (not virtual database)
   * This is used during cleanup operations to remove actual files only
   */
  private async deleteRealFile(filePath: string): Promise<{ success: boolean; message?: string }> {
    try {
      const paths = this.traefikFileSystemService.getFileSystemPaths();
      const fullPath = path.join(paths.basePath, filePath);
      
      // Check if file exists
      try {
        await fs.promises.access(fullPath);
      } catch {
        // File doesn't exist, consider it successful
        return { success: true, message: 'File did not exist' };
      }
      
      // Delete the real file
      await fs.promises.unlink(fullPath);
      this.logger.debug(`Successfully deleted real file: ${fullPath}`);
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to delete real file ${filePath}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the sync service and filesystem structure
   */
  async initialize(): Promise<void> {
    this.logger.log('Initializing TraefikSyncService');
    
    try {
      // Initialize filesystem structure using filesystem service
      await this.traefikFileSystemService.initializeFileSystemStructure();
      
      this.logger.log('TraefikSyncService initialization completed');
    } catch (error) {
      this.logger.error('Failed to initialize TraefikSyncService:', error);
      throw new Error(`TraefikSyncService initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}