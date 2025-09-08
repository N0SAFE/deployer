import { Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import {
  traefikConfigs,
  configFiles,
  traefikInstances,
  type TraefikConfig,
  type CreateConfigFile
} from '../../../core/modules/db/drizzle/schema/traefik';

export interface FileSyncOptions {
  forceSync?: boolean; // Force sync even if file appears up to date
  validateChecksum?: boolean; // Validate file checksum before writing
  createDirectories?: boolean; // Create parent directories if they don't exist
  backupExisting?: boolean; // Backup existing files before overwriting
}

export interface SyncResult {
  success: boolean;
  filePath: string;
  action: 'created' | 'updated' | 'skipped' | 'error' | 'removed';
  message?: string;
  checksum?: string;
  fileSize?: number;
}

@Injectable()
export class ConfigFileSyncService {
  private readonly logger = new Logger(ConfigFileSyncService.name);
  private readonly basePath = process.env.TRAEFIK_CONFIG_BASE_PATH || '/tmp/traefik-configs';
  private readonly backupPath = process.env.TRAEFIK_BACKUP_PATH || '/tmp/traefik-backups';

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Sync a specific configuration to file system
   */
  async syncConfigurationToFile(
    configId: string,
    options: FileSyncOptions = {}
  ): Promise<SyncResult> {
    const {
      forceSync = false,
      validateChecksum = true,
      createDirectories = true,
      backupExisting = false
    } = options;

    try {
      // Get configuration from database
      const [config] = await this.databaseService.db
        .select()
        .from(traefikConfigs)
        .where(eq(traefikConfigs.id, configId))
        .limit(1);

      if (!config) {
        throw new Error(`Configuration not found: ${configId}`);
      }

      if (!config.requiresFile) {
        this.logger.debug(`Configuration ${configId} does not require file sync, skipping`);
        return {
          success: true,
          filePath: '',
          action: 'skipped',
          message: 'Configuration does not require file'
        };
      }

      // Generate file path if not set
      let filePath = config.configPath;
      if (!filePath) {
        filePath = this.generateFilePath(config);
        await this.updateConfigPath(configId, filePath);
      }

      const absolutePath = path.resolve(this.basePath, filePath);

      // Create directories if needed
      if (createDirectories) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      }

      // Check if file sync is needed
      const fileExists = await this.fileExists(absolutePath);
      const currentChecksum = this.calculateChecksum(config.configContent);

      if (!forceSync && fileExists && config.fileChecksum === currentChecksum) {
        // Check if file on disk matches our checksum
        if (validateChecksum) {
          const diskChecksum = await this.calculateFileChecksum(absolutePath);
          if (diskChecksum === currentChecksum) {
            this.logger.debug(`File ${absolutePath} is up to date, skipping sync`);
            return {
              success: true,
              filePath: absolutePath,
              action: 'skipped',
              message: 'File is up to date'
            };
          }
        }
      }

      // Backup existing file if requested
      if (backupExisting && fileExists) {
        await this.backupFile(absolutePath);
      }

      // Write configuration to file
      await fs.writeFile(absolutePath, config.configContent, 'utf8');

      // Get file stats
      const stats = await fs.stat(absolutePath);
      const finalChecksum = await this.calculateFileChecksum(absolutePath);

      // Update database with sync status
      await this.updateSyncStatus(configId, {
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
        fileChecksum: finalChecksum,
        syncErrorMessage: null
      });

      // Update or create config file record
      await this.updateConfigFileRecord(configId, absolutePath, {
        fileSize: stats.size,
        checksum: finalChecksum,
        exists: true,
        isWritable: true,
        writeErrorMessage: null
      });

      this.logger.log(`Successfully synced configuration ${configId} to ${absolutePath}`);

      return {
        success: true,
        filePath: absolutePath,
        action: fileExists ? 'updated' : 'created',
        checksum: finalChecksum,
        fileSize: stats.size
      };

    } catch (error) {
      this.logger.error(`Failed to sync configuration ${configId} to file:`, error);

      // Update database with error status
      await this.updateSyncStatus(configId, {
        syncStatus: 'failed',
        lastSyncedAt: new Date(),
        syncErrorMessage: error instanceof Error ? error.message : 'Unknown sync error'
      });

      return {
        success: false,
        filePath: '',
        action: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Sync all configurations for a Traefik instance
   * Database is the source of truth - sync active configs and remove inactive ones
   * If instance is stopped, all configuration files should be removed
   */
  async syncInstanceConfigurations(
    instanceId: string,
    options: FileSyncOptions = {}
  ): Promise<SyncResult[]> {
    
    // Check the instance status first
    const [instance] = await this.databaseService.db
      .select({ status: traefikInstances.status })
      .from(traefikInstances)
      .where(eq(traefikInstances.id, instanceId))
      .limit(1);
    
    const instanceStatus = instance?.status || 'stopped';
    this.logger.debug(`Syncing configurations for instance ${instanceId} (status: ${instanceStatus})`);

    // Get all configurations for this instance
    const allConfigs = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(eq(traefikConfigs.traefikInstanceId, instanceId));

    const results: SyncResult[] = [];

    for (const config of allConfigs) {
      // If instance is stopped, remove all configuration files regardless of config.isActive
      if (instanceStatus === 'stopped') {
        if (config.configPath) {
          const result = await this.removeConfigurationFile(config.id);
          results.push(result);
        }
      } else if (config.isActive && config.requiresFile) {
        // Instance is running - sync active configurations that require files
        const result = await this.syncConfigurationToFile(config.id, options);
        results.push(result);
      } else if (config.configPath) {
        // Instance is running but config is inactive - remove files for inactive configurations
        const result = await this.removeConfigurationFile(config.id);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Remove configuration file from filesystem and update database
   */
  async removeConfigurationFile(configId: string): Promise<SyncResult> {
    try {
      // Get configuration from database
      const [config] = await this.databaseService.db
        .select()
        .from(traefikConfigs)
        .where(eq(traefikConfigs.id, configId))
        .limit(1);

      if (!config) {
        throw new Error(`Configuration not found: ${configId}`);
      }

      if (!config.requiresFile || !config.configPath) {
        this.logger.debug(`Configuration ${configId} does not have a file to remove`);
        return {
          success: true,
          filePath: '',
          action: 'skipped',
          message: 'Configuration does not have a file'
        };
      }

      const absolutePath = path.resolve(this.basePath, config.configPath);
      
      // Check if file exists
      const fileExists = await this.fileExists(absolutePath);
      
      if (!fileExists) {
        this.logger.warn(`Configuration file ${absolutePath} does not exist, marking as removed`);
        
        // Update database to reflect file removal
        await this.updateSyncStatus(configId, {
          syncStatus: 'removed',
          lastSyncedAt: new Date(),
          fileChecksum: undefined,
          syncErrorMessage: null
        });

        await this.removeConfigFileRecord(configId);

        return {
          success: true,
          filePath: absolutePath,
          action: 'skipped',
          message: 'File did not exist'
        };
      }

      // Remove the file
      await fs.unlink(absolutePath);

      // Update database to reflect file removal
      await this.updateSyncStatus(configId, {
        syncStatus: 'removed',
        lastSyncedAt: new Date(),
        fileChecksum: undefined,
        syncErrorMessage: null
      });

      // Remove config file record
      await this.removeConfigFileRecord(configId);

      this.logger.log(`Successfully removed configuration file ${absolutePath} for config ${configId}`);

      return {
        success: true,
        filePath: absolutePath,
        action: 'removed',
        message: 'File successfully removed'
      };

    } catch (error) {
      this.logger.error(`Failed to remove configuration file for ${configId}:`, error);

      // Update database with error status
      await this.updateSyncStatus(configId, {
        syncStatus: 'failed',
        lastSyncedAt: new Date(),
        syncErrorMessage: error instanceof Error ? error.message : 'Unknown removal error'
      });

      return {
        success: false,
        filePath: '',
        action: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Sync all configurations and remove orphaned files
   * This ensures the filesystem matches the database state exactly
   */
  async fullSyncWithCleanup(instanceId?: string): Promise<{
    syncResults: SyncResult[];
    removedOrphans: string[];
    total: number;
    successful: number;
    failed: number;
  }> {
    this.logger.log('Starting full sync with cleanup - database is source of truth');

    // Step 1: Sync all active configurations to files
    const syncResults = await this.forceSyncAll(instanceId);

    // Step 2: Remove orphaned files
    const removedOrphans = await this.cleanupOrphanedFiles(instanceId);

    this.logger.log(`Full sync with cleanup completed: ${syncResults.successful} synced, ${syncResults.failed} failed, ${removedOrphans.length} orphans removed`);

    return {
      syncResults: syncResults.results,
      removedOrphans,
      total: syncResults.total,
      successful: syncResults.successful,
      failed: syncResults.failed
    };
  }

  /**
   * Clean up orphaned configuration files
   * If instance is stopped, ALL files for that instance should be removed
   * If instance is running, only files for active configs that require files should exist
   */
  async cleanupOrphanedFiles(instanceId?: string): Promise<string[]> {
    let instanceStatus = 'running'; // default assumption for backward compatibility
    
    // If instanceId is provided, check the instance status
    if (instanceId) {
      const [instance] = await this.databaseService.db
        .select({ status: traefikInstances.status })
        .from(traefikInstances)
        .where(eq(traefikInstances.id, instanceId))
        .limit(1);
      
      if (instance) {
        instanceStatus = instance.status;
        this.logger.debug(`Cleaning up files for instance ${instanceId} (status: ${instanceStatus})`);
      }
    }

    // If instance is stopped, ALL its files should be removed
    if (instanceId && instanceStatus === 'stopped') {
      const orphanedFiles: string[] = [];
      const instancePath = path.join(this.basePath, instanceId);
      
      try {
        // Remove all files in the instance directory
        const allInstanceFiles = await this.getAllConfigFilesInDirectory(instancePath);
        
        for (const filePath of allInstanceFiles) {
          try {
            await fs.unlink(filePath);
            orphanedFiles.push(filePath);
            this.logger.log(`Cleaned up file for stopped instance: ${filePath}`);
          } catch (error) {
            this.logger.warn(`Failed to clean up file ${filePath}:`, error);
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to clean up files for stopped instance ${instanceId}:`, error);
      }
      
      return orphanedFiles;
    }

    // Instance is running - get only active configuration files that should exist
    const activeConfigs = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(instanceId 
        ? and(
            eq(traefikConfigs.traefikInstanceId, instanceId),
            eq(traefikConfigs.isActive, true),
            eq(traefikConfigs.requiresFile, true)
          )
        : and(
            eq(traefikConfigs.isActive, true),
            eq(traefikConfigs.requiresFile, true)
          )
      );

    const activeFilePaths = new Set(
      activeConfigs
        .filter(config => config.configPath)
        .map(config => path.resolve(this.basePath, config.configPath!))
    );

    // Get all files in the traefik configs directory
    const allFiles = instanceId 
      ? await this.getAllConfigFilesInDirectory(path.join(this.basePath, instanceId))
      : await this.getAllConfigFiles();
    const orphanedFiles: string[] = [];

    for (const filePath of allFiles) {
      if (!activeFilePaths.has(filePath)) {
        try {
          await fs.unlink(filePath);
          orphanedFiles.push(filePath);
          this.logger.log(`Cleaned up orphaned file: ${filePath}`);
        } catch (error) {
          this.logger.warn(`Failed to clean up orphaned file ${filePath}:`, error);
        }
      }
    }

    return orphanedFiles;
  }

  /**
   * Validate file synchronization status
   */
  async validateSyncStatus(configId: string): Promise<{
    isValid: boolean;
    issues: string[];
    lastSyncedAt?: Date;
  }> {
    const [config] = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(eq(traefikConfigs.id, configId))
      .limit(1);

    if (!config) {
      return {
        isValid: false,
        issues: ['Configuration not found']
      };
    }

    const issues: string[] = [];

    if (!config.requiresFile) {
      return {
        isValid: true,
        issues: [],
        lastSyncedAt: config.lastSyncedAt || undefined
      };
    }

    if (!config.configPath) {
      issues.push('Configuration path not set');
    }

    if (config.syncStatus === 'failed') {
      issues.push(`Sync failed: ${config.syncErrorMessage || 'Unknown error'}`);
    }

    if (config.syncStatus === 'outdated') {
      issues.push('Configuration is outdated and needs sync');
    }

    if (config.configPath) {
      const absolutePath = path.resolve(this.basePath, config.configPath);
      const fileExists = await this.fileExists(absolutePath);
      
      if (!fileExists) {
        issues.push('Configuration file does not exist on filesystem');
      } else {
        // Check checksum if file exists
        const diskChecksum = await this.calculateFileChecksum(absolutePath);
        const expectedChecksum = this.calculateChecksum(config.configContent);
        
        if (diskChecksum !== expectedChecksum) {
          issues.push('File content does not match database configuration');
        }
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      lastSyncedAt: config.lastSyncedAt || undefined
    };
  }

  /**
   * Force sync all configurations (useful for recovery)
   * Database is the source of truth - sync active configs and remove inactive ones
   * If instance is stopped, all configuration files should be removed
   */
  async forceSyncAll(instanceId?: string): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: SyncResult[];
  }> {

    // If instanceId is provided, check the instance status first
    let instanceStatus = 'running'; // default assumption for backward compatibility
    if (instanceId) {
      const [instance] = await this.databaseService.db
        .select({ status: traefikInstances.status })
        .from(traefikInstances)
        .where(eq(traefikInstances.id, instanceId))
        .limit(1);
      
      if (instance) {
        instanceStatus = instance.status;
        this.logger.debug(`Instance ${instanceId} status: ${instanceStatus}`);
      }
    }

    const configs = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(instanceId ? eq(traefikConfigs.traefikInstanceId, instanceId) : undefined);

    const results: SyncResult[] = [];
    let successful = 0;
    let failed = 0;

    for (const config of configs) {
      let result: SyncResult;
      
      // If instance is stopped, remove all configuration files regardless of config.isActive
      if (instanceStatus === 'stopped') {
        if (config.configPath) {
          result = await this.removeConfigurationFile(config.id);
        } else {
          result = {
            success: true,
            filePath: '',
            action: 'skipped',
            message: 'Instance stopped - no file to remove'
          };
        }
      } else if (config.isActive && config.requiresFile) {
        // Instance is running - sync active configurations that require files
        result = await this.syncConfigurationToFile(config.id, { 
          forceSync: true,
          createDirectories: true,
          backupExisting: true
        });
      } else if (config.configPath) {
        // Instance is running but config is inactive - remove files for inactive configurations
        result = await this.removeConfigurationFile(config.id);
      } else {
        // Skip configurations that don't have files and don't need them
        result = {
          success: true,
          filePath: '',
          action: 'skipped',
          message: 'Configuration does not require file sync'
        };
      }
      
      results.push(result);
      
      if (result.success) {
        successful++;
      } else {
        failed++;
      }
    }

    this.logger.log(`Force sync completed: ${successful} successful, ${failed} failed out of ${configs.length} total (instance status: ${instanceStatus})`);

    return {
      total: configs.length,
      successful,
      failed,
      results
    };
  }

  /**
   * Generate file path for configuration
   */
  private generateFilePath(config: TraefikConfig): string {
    const sanitizedName = config.configName.replace(/[^a-zA-Z0-9\-_.]/g, '_');
    const extension = config.configType === 'static' ? 'yml' : 'yml';
    return path.join(config.traefikInstanceId, config.configType, `${sanitizedName}.${extension}`);
  }

  /**
   * Calculate checksum for content
   */
  private calculateChecksum(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Calculate checksum for file
   */
  private async calculateFileChecksum(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath, 'utf8');
    return this.calculateChecksum(content);
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Backup existing file
   */
  private async backupFile(filePath: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `${path.basename(filePath)}.backup.${timestamp}`;
    const backupFilePath = path.join(this.backupPath, backupFileName);

    await fs.mkdir(this.backupPath, { recursive: true });
    await fs.copyFile(filePath, backupFilePath);

    this.logger.debug(`Backed up ${filePath} to ${backupFilePath}`);
    return backupFilePath;
  }

  /**
   * Get all configuration files in the base directory
   */
  private async getAllConfigFiles(): Promise<string[]> {
    return this.getAllConfigFilesInDirectory(this.basePath);
  }

  /**
   * Get all configuration files in a specific directory
   */
  private async getAllConfigFilesInDirectory(directory: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const scan = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            await scan(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
            files.push(fullPath);
          }
        }
      };

      await scan(directory);
    } catch (error) {
      this.logger.error(`Failed to scan configuration directory ${directory}:`, error);
    }

    return files;
  }

  /**
   * Remove config file record from database
   */
  private async removeConfigFileRecord(configId: string): Promise<void> {
    await this.databaseService.db
      .delete(configFiles)
      .where(eq(configFiles.traefikConfigId, configId));
  }

  /**
   * Update configuration sync status in database
   */
  private async updateSyncStatus(
    configId: string,
    updates: {
      syncStatus?: string;
      lastSyncedAt?: Date;
      fileChecksum?: string;
      syncErrorMessage?: string | null;
    }
  ): Promise<void> {
    await this.databaseService.db
      .update(traefikConfigs)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(traefikConfigs.id, configId));
  }

  /**
   * Update configuration path in database
   */
  private async updateConfigPath(configId: string, configPath: string): Promise<void> {
    await this.databaseService.db
      .update(traefikConfigs)
      .set({
        configPath,
        updatedAt: new Date()
      })
      .where(eq(traefikConfigs.id, configId));
  }

  /**
   * Update or create config file record
   */
  private async updateConfigFileRecord(
    configId: string,
    filePath: string,
    updates: {
      fileSize?: number;
      checksum?: string;
      exists?: boolean;
      isWritable?: boolean;
      writeErrorMessage?: string | null;
    }
  ): Promise<void> {
    // Check if record exists
    const [existing] = await this.databaseService.db
      .select()
      .from(configFiles)
      .where(eq(configFiles.traefikConfigId, configId))
      .limit(1);

    if (existing) {
      // Update existing record
      await this.databaseService.db
        .update(configFiles)
        .set({
          ...updates,
          lastWriteAttempt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(configFiles.id, existing.id));
    } else {
      // Create new record
      const configFileData: CreateConfigFile = {
        id: randomUUID(),
        traefikConfigId: configId,
        filePath,
        fileSize: updates.fileSize || null,
        checksum: updates.checksum || null,
        permissions: '644',
        owner: 'traefik',
        exists: updates.exists || null,
        isWritable: updates.isWritable || null,
        lastWriteAttempt: new Date(),
        writeErrorMessage: updates.writeErrorMessage || null,
        containerPath: null,
        mountPoint: null
      };

      await this.databaseService.db
        .insert(configFiles)
        .values(configFileData);
    }
  }

  /**
   * Find existing configuration with the same path and content
   */
  async findDuplicateConfiguration(
    instanceId: string,
    configPath: string,
    configContent: string
  ): Promise<TraefikConfig | null> {
    const contentChecksum = this.calculateChecksum(configContent);
    
    const [existing] = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(
        and(
          eq(traefikConfigs.traefikInstanceId, instanceId),
          eq(traefikConfigs.configPath, configPath),
          eq(traefikConfigs.fileChecksum, contentChecksum)
        )
      )
      .limit(1);

    return existing || null;
  }

  /**
   * Find all configurations with the same path and content for merging
   */
  async findAllDuplicateConfigurations(
    instanceId: string,
    configPath: string,
    configContent: string
  ): Promise<TraefikConfig[]> {
    const contentChecksum = this.calculateChecksum(configContent);
    
    const duplicates = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(
        and(
          eq(traefikConfigs.traefikInstanceId, instanceId),
          eq(traefikConfigs.configPath, configPath),
          eq(traefikConfigs.fileChecksum, contentChecksum)
        )
      );

    return duplicates;
  }

  /**
   * Merge duplicate configurations into a single record
   * Keeps the most recent one and removes the others
   */
  async mergeDuplicateConfigurations(instanceId: string): Promise<{
    merged: number;
    kept: number;
    removed: string[];
  }> {
    this.logger.log(`Starting deduplication for instance ${instanceId}`);

    // Get all configurations for this instance
    const allConfigs = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(eq(traefikConfigs.traefikInstanceId, instanceId));

    // Group by path and content hash
    const groups = new Map<string, TraefikConfig[]>();
    
    for (const config of allConfigs) {
      if (config.configPath && config.fileChecksum) {
        const key = `${config.configPath}:${config.fileChecksum}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(config);
      }
    }

    const removed: string[] = [];
    let merged = 0;
    let kept = 0;

    // Process each group of duplicates
    for (const [key, configs] of groups) {
      if (configs.length > 1) {
        // Sort by creation date (newest first)
        configs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        
        const keepConfig = configs[0]; // Keep the newest one
        const removeConfigs = configs.slice(1); // Remove the rest

        this.logger.log(
          `Found ${configs.length} duplicates for ${key}, keeping ${keepConfig.id}, removing ${removeConfigs.length} others`
        );

        // Remove duplicate configurations
        for (const config of removeConfigs) {
          try {
            // Remove associated config files first
            await this.removeConfigFileRecord(config.id);
            
            // Remove the configuration
            await this.databaseService.db
              .delete(traefikConfigs)
              .where(eq(traefikConfigs.id, config.id));

            removed.push(config.id);
            merged++;

            this.logger.debug(`Removed duplicate configuration ${config.id} (${config.configName})`);
          } catch (error) {
            this.logger.error(`Failed to remove duplicate configuration ${config.id}:`, error);
          }
        }

        kept++;
      } else {
        kept++;
      }
    }

    this.logger.log(
      `Deduplication completed: ${merged} duplicates merged, ${kept} configurations kept, ${removed.length} records removed`
    );

    return {
      merged,
      kept,
      removed
    };
  }

  /**
   * Check if configuration should be created or if duplicate exists
   * Returns existing configuration ID if duplicate found, null if should create new
   */
  async checkForDuplicateBeforeCreate(
    instanceId: string,
    configPath: string,
    configContent: string,
    configName: string
  ): Promise<{
    shouldCreate: boolean;
    existingId?: string;
    message: string;
  }> {
    const contentChecksum = this.calculateChecksum(configContent);
    
    // Check for exact match (path + content)
    const exactMatch = await this.findDuplicateConfiguration(instanceId, configPath, configContent);
    
    if (exactMatch) {
      this.logger.debug(
        `Found exact duplicate for ${configName} at ${configPath}, using existing config ${exactMatch.id}`
      );
      
      return {
        shouldCreate: false,
        existingId: exactMatch.id,
        message: `Using existing configuration with matching path and content`
      };
    }

    // Check for path conflict with different content
    const [pathConflict] = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(
        and(
          eq(traefikConfigs.traefikInstanceId, instanceId),
          eq(traefikConfigs.configPath, configPath)
        )
      )
      .limit(1);

    if (pathConflict && pathConflict.fileChecksum !== contentChecksum) {
      this.logger.warn(
        `Path conflict detected for ${configPath}: existing config ${pathConflict.id} has different content`
      );
      
      return {
        shouldCreate: false,
        existingId: pathConflict.id,
        message: `Path conflict: updating existing configuration with new content`
      };
    }

    return {
      shouldCreate: true,
      message: `No duplicates found, creating new configuration`
    };
  }

  /**
   * Update existing configuration content and metadata
   */
  async updateConfigurationContent(
    configId: string,
    newContent: string,
    newName?: string
  ): Promise<boolean> {
    try {
      const newChecksum = this.calculateChecksum(newContent);
      
      const updates: any = {
        configContent: newContent,
        fileChecksum: newChecksum,
        configVersion: Date.now(), // Use timestamp as version
        syncStatus: 'outdated', // Mark as needing sync
        updatedAt: new Date()
      };

      if (newName) {
        updates.configName = newName;
      }

      await this.databaseService.db
        .update(traefikConfigs)
        .set(updates)
        .where(eq(traefikConfigs.id, configId));

      this.logger.log(`Updated configuration ${configId} with new content`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to update configuration ${configId}:`, error);
      return false;
    }
  }

  /**
   * Perform full deduplication and sync for an instance
   */
  async deduplicateAndSync(instanceId: string): Promise<{
    deduplication: {
      merged: number;
      kept: number;
      removed: string[];
    };
    sync: {
      syncResults: SyncResult[];
      removedOrphans: string[];
      total: number;
      successful: number;
      failed: number;
    };
  }> {
    this.logger.log(`Starting deduplication and sync for instance ${instanceId}`);

    // Step 1: Deduplicate configurations
    const deduplication = await this.mergeDuplicateConfigurations(instanceId);

    // Step 2: Perform full sync with cleanup
    const sync = await this.fullSyncWithCleanup(instanceId);

    this.logger.log(
      `Deduplication and sync completed: ${deduplication.merged} merged, ${sync.successful} synced, ${sync.failed} failed`
    );

    return {
      deduplication,
      sync
    };
  }
}