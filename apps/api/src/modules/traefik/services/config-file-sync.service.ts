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
  type TraefikConfig,
  type ConfigFile,
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
  action: 'created' | 'updated' | 'skipped' | 'error';
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
   */
  async syncInstanceConfigurations(
    instanceId: string,
    options: FileSyncOptions = {}
  ): Promise<SyncResult[]> {
    const configs = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(and(
        eq(traefikConfigs.traefikInstanceId, instanceId),
        eq(traefikConfigs.isActive, true),
        eq(traefikConfigs.requiresFile, true)
      ));

    const results: SyncResult[] = [];

    for (const config of configs) {
      const result = await this.syncConfigurationToFile(config.id, options);
      results.push(result);
    }

    return results;
  }

  /**
   * Clean up orphaned configuration files
   */
  async cleanupOrphanedFiles(instanceId?: string): Promise<string[]> {
    const conditions = instanceId 
      ? [eq(traefikConfigs.traefikInstanceId, instanceId)]
      : [];

    // Get all configuration files that should exist
    const activeConfigs = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(instanceId ? eq(traefikConfigs.traefikInstanceId, instanceId) : undefined);

    const activeFilePaths = new Set(
      activeConfigs
        .filter(config => config.requiresFile && config.configPath)
        .map(config => path.resolve(this.basePath, config.configPath!))
    );

    // Get all files in the traefik configs directory
    const allFiles = await this.getAllConfigFiles();
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
   */
  async forceSyncAll(instanceId?: string): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: SyncResult[];
  }> {
    const conditions = instanceId 
      ? [eq(traefikConfigs.traefikInstanceId, instanceId)]
      : [];

    const configs = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(instanceId ? eq(traefikConfigs.traefikInstanceId, instanceId) : undefined);

    const results: SyncResult[] = [];
    let successful = 0;
    let failed = 0;

    for (const config of configs) {
      const result = await this.syncConfigurationToFile(config.id, { 
        forceSync: true,
        createDirectories: true,
        backupExisting: true
      });
      
      results.push(result);
      
      if (result.success) {
        successful++;
      } else {
        failed++;
      }
    }

    this.logger.log(`Force sync completed: ${successful} successful, ${failed} failed out of ${configs.length} total`);

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

      await scan(this.basePath);
    } catch (error) {
      this.logger.error(`Failed to scan configuration directory ${this.basePath}:`, error);
    }

    return files;
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
}