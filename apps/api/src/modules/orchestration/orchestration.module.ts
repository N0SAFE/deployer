import { Module } from '@nestjs/common';
import { CoreModule } from '@/core/core.module';

// Import controllers and processors
// Legacy `OrchestrationController` has been deprecated and its implementation migrated to
// `OrchestrationOrpcController` and `OrchestrationRestController`. We keep the file for
// historical reference but do not register it to avoid duplicate route handlers.
import { OrchestrationOrpcController } from './controllers/orchestration-orpc.controller';
import { OrchestrationRestController } from './controllers/rest/orchestration.controller';
import { DeploymentProcessor } from './processors/deployment.processor';

/**
 * FEATURE MODULE: Orchestration Controllers and Processors
 * 
 * This module provides the application logic layer for orchestration:
 * - ORPC endpoints (type-safe API)
 * - REST endpoints (traditional HTTP API)
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
        CoreModule,
    ],
    controllers: [
        // Legacy `OrchestrationController` removed from registration to prevent
        // duplicate ORPC handler registrations. Use `OrchestrationOrpcController`
        // for type-safe API and `OrchestrationRestController` for REST endpoints.
        OrchestrationOrpcController,
        OrchestrationRestController,
    ],
    providers: [
        DeploymentProcessor,                // Bull processor (migrated from core)
    ],
    exports: [],
})
export class OrchestrationControllerModule {
}
