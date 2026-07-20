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
import { NodeConfigRepository } from '@/core/modules/setup/repositories/node-config.repository';
import { LocalDatabaseModule } from '@/core/modules/database/local/local-database.module';
import { SetupWizardBridge } from '@/sub-apps/setup-wizard/setup-wizard.bridge';
import { MeshInitializerBridge } from './mesh-initializer.bridge';

@Module({
  imports: [
    MeshInitializationModule,
    LocalDatabaseModule,
  ],
  providers: [
    MeshInitializerService,
    NodeConfigRepository,
    SetupWizardBridge,
    MeshInitializerBridge,
  ],
})
export class MeshInitializerAppModule {}
