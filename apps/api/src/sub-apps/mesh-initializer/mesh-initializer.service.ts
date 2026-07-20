import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { SetupWizardBridge, type SetupWizardBridgePayload } from '@/sub-apps/setup-wizard/setup-wizard.bridge';
import { MeshInitializerBridge } from './mesh-initializer.bridge';
import { MeshInitializationService } from '@/core/modules/mesh/initialization/services/mesh-initialization.service';
import { NodeConfigRepository } from '@/core/modules/setup/repositories/node-config.repository';

/**
 * How long (ms) to wait for mesh peer connections before falling back to
 * the wizard URL with no mesh. This timeout starts AFTER the setup wizard
 * has completed, so it only covers the mesh discovery phase.
 */
const MESH_CONNECT_TIMEOUT_MS = 25_000;

@Injectable()
export class MeshInitializerService implements OnModuleInit {
  private readonly logger = new Logger(MeshInitializerService.name);

  constructor(
    // SetupWizardBridge is forwarded to this sub-app context by SubAppRunner.
    // waitForOrTimeout() polls _lastValue so it works across contexts where
    // the RxJS event system may not bridge subject subscriptions.
    private readonly wizardBridge: SetupWizardBridge,
    private readonly meshBridge: MeshInitializerBridge,
    private readonly meshInitService: MeshInitializationService,
    private readonly nodeConfigRepo: NodeConfigRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    // waitFor() uses a static shared state keyed by bridge class name,
    // so it works across different DI contexts sharing the same bridge type.
    const wizardResult: SetupWizardBridgePayload = await this.wizardBridge.waitFor();
    this.logger.log(`▶ Mesh initializer: wizard done (strategy=${wizardResult.strategy})`);

    const databaseUrl = wizardResult.databaseUrl;
    let meshConnected = false;
    let strategy: 'local' | 'remote' | 'mesh_discovered' = wizardResult.strategy;

    // 2. Try to connect to mesh peers using MeshInitializationService, with
    //    a service-level timeout so the bridge ALWAYS fires (even on timeout).
    const config = this.nodeConfigRepo.find();
    const meshUrls = config?.meshUrlsSnapshot ?? [];

    if (meshUrls.length > 0) {
      this.logger.log(`🔍 Mesh initializer: trying ${String(meshUrls.length)} mesh peer(s) (timeout: ${String(MESH_CONNECT_TIMEOUT_MS)}ms)...`);
      try {
        await Promise.race([
          (async () => {
            for (const url of meshUrls) {
              try {
                await this.meshInitService.connectToMesh(url);
                this.logger.log(`✅ Mesh initializer: connected to peer at ${url}`);
                meshConnected = true;
                strategy = 'mesh_discovered';
                return;
              } catch {
                this.logger.warn(`⚠️ Mesh initializer: peer ${url} unreachable`);
              }
            }
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Mesh peer connection timed out after ${String(MESH_CONNECT_TIMEOUT_MS)}ms`)), MESH_CONNECT_TIMEOUT_MS),
          ),
        ]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`⏱️  Mesh initializer: ${msg} — falling back to wizard URL without mesh`);
      }
    } else {
      this.logger.log('ℹ️  Mesh initializer: no mesh peers in config — using wizard URL');
    }

    // 3. Fire the bridge with the final database URL (ALWAYS fires, even on timeout)
    this.logger.log(`✅ Mesh initializer: DB URL resolved (strategy=${strategy}, mesh=${String(meshConnected)})`);
    this.meshBridge.emit({
      databaseUrl,
      strategy,
      nodeId: wizardResult.nodeId,
      meshConnected,
    });
    this.meshBridge.complete();
  }
}
