import { Global, Module } from '@nestjs/common'
import { BootstrapOrchestratorService } from './bootstrap-orchestrator.service'
import { EnvModule } from '@/config/env/env.module'
import { SetupWizardBridge } from '@/sub-apps/setup-wizard/setup-wizard.bridge'
import { MeshInitializerBridge } from '@/sub-apps/mesh-initializer/mesh-initializer.bridge'
import { GlobalDatabaseModule } from '../database/global/global-database.module'

@Global()
@Module({
  imports: [EnvModule, GlobalDatabaseModule],
  providers: [
    BootstrapOrchestratorService,
    SetupWizardBridge,
    MeshInitializerBridge,
  ],
  exports: [
    BootstrapOrchestratorService,
    SetupWizardBridge,
    MeshInitializerBridge,
  ],
})
export class BootstrapModule {}