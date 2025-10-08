import { Global, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { ZombieCleanupService } from "@/core/modules/docker/services/zombie-cleanup.service";

@Global()
@Injectable()
export class ZombieCleanupBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(ZombieCleanupBootstrap.name);

  constructor(
    private readonly zombieCleanupService: ZombieCleanupService
  ) {}

  /**
   * Run cleanup on application startup
   * IMPORTANT: Resume incomplete deployments BEFORE other cleanup
   */
  async onApplicationBootstrap() {
    this.logger.log("Running initial startup reconciliation...");
    try {
      // Step 1: Resume incomplete deployments (highest priority)
      await this.zombieCleanupService.resumeIncompleteDeployments();

      // Step 2: Regular cleanup
      await this.zombieCleanupService.autoCleanup();

      this.logger.log("Initial startup reconciliation completed");
    } catch (error) {
      this.logger.error("Failed to run initial reconciliation:", error);
    }
  }
}
