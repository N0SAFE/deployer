import { Module, forwardRef } from '@nestjs/common';
import { CoreModule } from '@/core/core.module';

// Import controllers and processors
import { OrchestrationOrpcController } from './controllers/orchestration-orpc.controller';
import { DeploymentProcessor } from './processors/deployment.processor';
import { OrchestrationAdapter } from './adapters/orchestration-adapter.service';

/**
 * FEATURE MODULE: Orchestration Controllers and Processors
 * 
 * This module provides the application logic layer for orchestration:
 * - ORPC endpoints (type-safe API)
 * - Deployment processing (Bull queue processor)
 * 
 * Core modules should ONLY provide services (no controllers, no processors).
 * Feature modules contain controllers, processors, and application logic.
 * 
 * Imports CoreModule to access all core services.
 */
@Module({
    imports: [
        // Core modules (all services available)
        forwardRef(() => CoreModule),
    ],
    controllers: [
        // ORPC controller for type-safe API endpoints
        OrchestrationOrpcController,
    ],
    providers: [
        DeploymentProcessor,                // Bull processor (migrated from core)
        OrchestrationAdapter,               // Service-to-contract adapter
    ],
    exports: [],
})
export class OrchestrationControllerModule {
}
