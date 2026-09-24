/**
 * MeshInitializerAppModule — Root module for the mesh initializer sub-app.
 *
 * Injects SUB_APP_RESULT(setupWizardBridge) (provided by SetupSubAppModule)
 * to get the wizard's database URL, then uses MeshInitializationService
 * to discover DB URL from mesh peers. Falls back to wizard URL.
 */

import { Module } from '@nestjs/common';
import { MeshInitializerService } from './mesh-initializer.service';
import { MeshInitializationModule } from '@/core/modules/mesh/initialization/mesh-initialization.module';
import { NodeStateModule } from '@/core/modules/node-state/node-state.module';
import { LocalDatabaseModule } from "@repo/nest-database-local/local-database.module";
import { SetupWizardBridge } from '@/sub-apps/setup-wizard/setup-wizard.bridge';
import { MeshInitializerBridge } from './mesh-initializer.bridge';

@Module({
  imports: [
    MeshInitializationModule,
    LocalDatabaseModule,
    // Sub-apps run in their OWN Nest context, so @Global() from the main app
    // does not reach them — the module must be imported explicitly. Importing
    // it (rather than redeclaring the provider) keeps ONE owner per repository.
    NodeStateModule,
  ],
  providers: [
    MeshInitializerService,
    SetupWizardBridge,
    MeshInitializerBridge,
  ],
})
export class MeshInitializerAppModule {}
