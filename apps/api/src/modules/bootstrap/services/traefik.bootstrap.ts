import { Global, Injectable, type OnApplicationBootstrap, Logger } from '@nestjs/common';
import { TraefikSyncService } from '@/core/modules/traefik/services/traefik-sync.service';
import { TraefikFileSystemService } from '@/core/modules/traefik/services/traefik-file-system.service';
import { EnvService } from '@/config/env/env.service';

/**
 * Bootstrap service for Traefik initialization
 * This runs AFTER CoreModule is fully initialized and migrations have completed
 */
@Global()
@Injectable()
export class TraefikBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(TraefikBootstrap.name);

  constructor(
        private readonly traefikSyncService: TraefikSyncService,
        private readonly traefikFileSystemService: TraefikFileSystemService,
        private readonly envService: EnvService,
    ) {}

    async onApplicationBootstrap() {
        try {
            this.logger.log('Starting Traefik initialization on application startup...');

            // Check if startup sync is enabled (can be disabled via environment variable)
            const startupSyncEnabled = this.envService.get('TRAEFIK_STARTUP_SYNC_ENABLED');
            
            if (!startupSyncEnabled) {
                this.logger.log('Traefik startup sync is disabled via configuration');
                return;
            }

            // Initialize filesystem structure
            await this.initializeFileSystem();

            // Perform initial sync
            await this.performInitialSync();

            this.logger.log('Traefik initialization completed successfully');
        } catch (error) {
            this.logger.error('Failed to initialize Traefik on startup:', error);
            
            // Check if we should fail the application startup on sync errors
            const failOnStartupError = this.envService.get('TRAEFIK_FAIL_ON_STARTUP_ERROR');
            
            if (failOnStartupError) {
                throw new Error(`Traefik startup initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            } else {
                this.logger.warn('Continuing application startup despite Traefik sync errors');
            }
        }
    }

    private async initializeFileSystem(): Promise<void> {
        this.logger.log('Initializing Traefik filesystem structure...');
        
        try {
            await this.traefikFileSystemService.initializeFileSystemStructure();
            this.logger.log('Traefik filesystem structure initialized');
        } catch (error) {
            this.logger.error('Failed to initialize filesystem structure:', error);
            throw error;
        }
    }

    private async performInitialSync(): Promise<void> {
        this.logger.log('Performing initial Traefik configuration sync...');
        
        try {
            const syncResult = await this.traefikSyncService.syncAllConfigurations();
            
            this.logger.log(`Initial sync completed: ${syncResult.successful}/${syncResult.total} configurations synced successfully`);
            
            if (syncResult.failed > 0) {
                this.logger.warn(`${syncResult.failed} configurations failed to sync during startup`);
                
                // Log details of failed syncs for debugging
                const failedResults = syncResult.results.filter(r => !r.success);
                failedResults.forEach(result => {
                    this.logger.warn(`Failed to sync ${result.configName} (${result.configId}): ${result.message}`);
                });
            }

            // Optionally clean up orphaned files during startup
            // NOTE: Disabled by default to prevent virtual file deletion during startup
            const cleanupOnStartup = this.envService.get('TRAEFIK_CLEANUP_ON_STARTUP');
            
            if (cleanupOnStartup) {
                this.logger.log('Performing startup cleanup of orphaned files...');
                this.logger.warn('CAUTION: Startup cleanup is enabled - this may delete virtual files if database sync is incomplete');
                const cleanupResult = await this.traefikSyncService.cleanupOrphanedFiles();
                
                const deletedCount = cleanupResult.results.filter(r => r.action === 'deleted').length;
                if (deletedCount > 0) {
                    this.logger.log(`Removed ${deletedCount} orphaned configuration files during startup`);
                } else {
                    this.logger.log('No orphaned files found during startup cleanup');
                }
            } else {
                this.logger.log('Startup cleanup is disabled (recommended to prevent virtual file deletion)');
            }
        } catch (error) {
            this.logger.error('Failed to perform initial sync:', error);
            throw error;
        }
    }

    /**
     * Manual trigger for re-initialization (useful for development or admin operations)
     */
    async reinitialize(): Promise<{ success: boolean; message: string; details?: any }> {
        try {
            this.logger.log('Manual re-initialization triggered...');
            
            await this.initializeFileSystem();
            await this.performInitialSync();
            
            this.logger.log('Manual re-initialization completed successfully');
            
            return {
                success: true,
                message: 'Traefik re-initialization completed successfully'
            };
        } catch (error) {
            this.logger.error('Manual re-initialization failed:', error);
            
            return {
                success: false,
                message: `Re-initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                details: error
            };
        }
    }

    /**
     * Health check method to verify Traefik filesystem state
     */
    async healthCheck(): Promise<{ 
        healthy: boolean; 
        filesystemInitialized: boolean; 
        configCount: number; 
        message: string; 
    }> {
        try {
            // Check if filesystem structure exists by checking if the base path exists
            const paths = this.traefikFileSystemService.getFileSystemPaths();
            const filesystemInitialized = await this.traefikFileSystemService.fileExists(paths.basePath);
            
            // Count configuration files
            let configCount = 0;
            if (filesystemInitialized) {
                const configFiles = await this.traefikFileSystemService.getAllConfigFiles();
                configCount = configFiles.length;
            }
            
            const healthy = filesystemInitialized;
            
            return {
                healthy,
                filesystemInitialized,
                configCount,
                message: healthy 
                    ? `Traefik is healthy with ${configCount} configuration files`
                    : 'Traefik filesystem is not properly initialized'
            };
        } catch (error) {
            this.logger.error('Health check failed:', error);
            
            return {
                healthy: false,
                filesystemInitialized: false,
                configCount: 0,
                message: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
}
