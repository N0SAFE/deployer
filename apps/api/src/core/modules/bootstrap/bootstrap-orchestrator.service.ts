/**
 * BootstrapOrchestratorService — Global bootstrap coordinator.
 *
 * Runs in OnApplicationBootstrap (inside the main-app sub-app).
 * Its job is simplified: the cascade in main.ts already handles sequential
 * sub-app startup (setup-app → main-app). This service just checks whether
 * the global database is available and signals lifecycle readiness.
 *
 * If the database was configured by previous runs (SQLite node_config has URL),
 * GlobalDatabaseModule initialized it during module init — nothing more to do.
 * If no database is configured, the setup wizard sub-app (setup-app) provides
 * the web UI for the user to configure it.
 */

import { Injectable, Logger } from '@nestjs/common'
import type { OnApplicationBootstrap } from '@nestjs/common'
import { GlobalDatabaseService } from '@/core/modules/database/global/global-database.service'
import { AppLifecycleService } from '@/core/modules/lifecycle/app-lifecycle.service'

@Injectable()
export class BootstrapOrchestratorService implements OnApplicationBootstrap {
    private readonly logger = new Logger(BootstrapOrchestratorService.name)

    constructor(
        private readonly globalDatabase: GlobalDatabaseService,
        private readonly lifecycle: AppLifecycleService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        this.logger.log('🚀 Bootstrap orchestrator checking DB state…')

        try {
            if (this.globalDatabase.isInitialized) {
                this.logger.log('✅ Global database is initialized and ready')
            } else {
                this.logger.log(
                    '⏳ No global database configured. ' +
                    'Use the setup wizard (http://localhost:3001/setup) to configure one.',
                )
            }

            // Signal lifecycle readiness regardless of DB state
            this.lifecycle.markReady()
            this.logger.log('✅ Bootstrap orchestrator completed')
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            this.logger.error(`❌ Bootstrap orchestrator failed: ${message}`)
            this.lifecycle.markError(message)
            throw err
        }
    }
}
