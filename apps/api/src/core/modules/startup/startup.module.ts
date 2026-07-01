/**
 * Startup Module
 *
 * Provides the StartupCoordinatorService and MeshVersionService for
 * the complete node startup protocol (version checking, setup state
 * management, mesh version comparison, upgrade coordination).
 *
 * This module is imported by:
 *   - CoreModule (for the main API lifecycle)
 *   - CLI commands (for setup / upgrade flows run from entrypoints)
 */

import { Module } from "@nestjs/common";
import { StartupCoordinatorService } from "./startup-coordinator.service";
import { MeshVersionService } from "./mesh-version.service";
import { MeshInitializationModule } from "@/core/modules/mesh/initialization/mesh-initialization.module";

@Module({
  imports: [MeshInitializationModule],
  providers: [
    MeshVersionService,
    StartupCoordinatorService,
  ],
  exports: [
    MeshVersionService,
    StartupCoordinatorService,
  ],
})
export class StartupModule {}
