/**
 * Startup Module
 *
 * Provides the StartupOrchestratorService which handles all startup tasks
 * (migrations, admin creation, mesh registration, schema reporting) in
 * NestJS lifecycle hooks.
 *
 * Import this module in AppModule to enable automatic startup orchestration.
 * The orchestrator will run on onModuleInit when the NestJS app starts.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "@/core/modules/database/database.module";
import { EnvModule } from "@/config/env/env.module";
import { MigrationJournalService } from "@/core/utils/migration-journal.service";
import { StartupOrchestratorService } from "./startup-orchestrator.service";

@Module({
  imports: [DatabaseModule, EnvModule],
  providers: [MigrationJournalService, StartupOrchestratorService],
  exports: [StartupOrchestratorService],
})
export class StartupModule {}
