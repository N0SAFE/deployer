import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigFileSyncService } from './config-file-sync.service';
import { TraefikService } from './traefik.service';

@Injectable()
export class TraefikStartupService implements OnModuleInit {
  private readonly logger = new Logger(TraefikStartupService.name);

  constructor(
    private readonly configFileSyncService: ConfigFileSyncService,
    private readonly traefikService: TraefikService,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 Starting Traefik configuration sync on startup...');
    
    try {
      // Use fullSyncWithCleanup to ensure database is source of truth
      const syncResult = await this.configFileSyncService.fullSyncWithCleanup('default');
      
      this.logger.log(
        `✅ Startup sync completed: ${syncResult.successful} successful, ${syncResult.failed} failed out of ${syncResult.total} total configurations, ${syncResult.removedOrphans.length} orphans removed`
      );

      if (syncResult.failed > 0) {
        this.logger.warn(
          `⚠️  Some configurations failed to sync during startup. Check individual config status.`
        );
        
        // Log failed sync details
        syncResult.syncResults
          .filter(result => !result.success)
          .forEach(result => {
            this.logger.error(`Failed to sync: ${result.filePath} - ${result.message}`);
          });
      }

      if (syncResult.removedOrphans.length > 0) {
        this.logger.log(`🧹 Cleaned up orphaned files: ${syncResult.removedOrphans.join(', ')}`);
      }

      // Log successful syncs for debugging
      if (process.env.NODE_ENV === 'development') {
        syncResult.syncResults
          .filter(result => result.success)
          .forEach(result => {
            this.logger.debug(`✅ Synced: ${result.filePath} (${result.action})`);
          });
      }

    } catch (error) {
      this.logger.error('❌ Failed to sync configurations on startup:', error);
    }
  }
}