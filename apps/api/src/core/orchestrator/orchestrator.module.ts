/**
 * OrchestrationModule — Root orchestration module for the sub-app pipeline.
 *
 * This is the ONLY module imported by main.ts. It handles:
 *   1. Gateway proxying (via RouterModule → RouterController)
 *   2. Sub-app lifecycle management (via OrchestratorService)
 *   3. Database URL resolution (via SetupDevModule in db-resolver step)
 *   4. Event-driven setup-wizard to main-app transition
 *
 * Sub-apps import core modules directly — no shared providers are forwarded.
 * The orchestrator only shares RESULTS between sub-apps, not DI providers.
 *
 * Pipeline:
 *   db-resolver (headless) → [setup-wizard if needed] → main-app (last)
 */

import { Module } from "@nestjs/common";
import { RouterModule } from "../router/router.module";
import { LocalDatabaseModule } from "../modules/database/local/local-database.module";
import { NodeConfigRepository } from "../modules/setup/repositories/node-config.repository";
import { OrchestratorService } from "./orchestrator.service";

@Module({
  imports: [RouterModule, LocalDatabaseModule],
  providers: [OrchestratorService, NodeConfigRepository],
})
export class OrchestrationModule {}
