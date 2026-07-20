/**
 * SetupSubAppModule — @Global() module that runs ALL setup sub-apps during startup.
 *
 * Imported by AppModule so sub-apps start before any core module initializes.
 * Runs sub-apps in order:
 *   1. SetupWizardSubApp — checks if wizard is needed, provides DB URL
 *   2. MeshInitializerSubApp — receives wizard result via DI, discovers DB URL
 *
 * Both bridges are provided as @Injectable() classes in this module.
 * SubAppRunner.forRoot() injects them from DI and forwards them to each
 * sub-app context, so the same bridge instance is shared across contexts.
 */

import { Global, Module } from '@nestjs/common';
import { SubAppRunner } from '@/core/modules/sub-app-runner/sub-app-runner.module';
import { SetupWizardAppModule } from '@/sub-apps/setup-wizard/setup-wizard.app.module';
import { SetupWizardBridge } from '@/sub-apps/setup-wizard/setup-wizard.bridge';
import { MeshInitializerAppModule } from '@/sub-apps/mesh-initializer/mesh-initializer.app.module';
import { MeshInitializerBridge } from '@/sub-apps/mesh-initializer/mesh-initializer.bridge';
import { MeshInitializationModule } from '@/core/modules/mesh/initialization/mesh-initialization.module';

@Global()
@Module({
  imports: [
    // 1. Setup wizard — checks config, waits for user if needed
    SubAppRunner.forRoot(SetupWizardAppModule, {
      bridgeClass: SetupWizardBridge,
    }),
    // 2. Mesh initializer — discovers DB URL from wizard result via forwarded bridge
    SubAppRunner.forRoot(MeshInitializerAppModule, {
      bridgeClass: MeshInitializerBridge,
      timeout: 30_000,
      imports: [MeshInitializationModule],
      providers: [SetupWizardBridge],
      forwardBridges: [SetupWizardBridge],
    }),
  ],
  providers: [
    SetupWizardBridge,
    MeshInitializerBridge,
  ],
  exports: [
    SetupWizardBridge,
    MeshInitializerBridge,
  ],
})
export class SetupSubAppModule {}
