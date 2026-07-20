import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EnvService } from '@/config/env/env.service';
import { SetupWizardBridge } from './setup-wizard.bridge';
import { InitializationService } from '@/core/modules/setup/services/initialization.service';
import { NodeConfigRepository } from '@/core/modules/setup/repositories/node-config.repository';
import { filter, take } from 'rxjs/operators';

@Injectable()
export class SetupWizardService implements OnModuleInit {
  private readonly logger = new Logger(SetupWizardService.name);

  constructor(
    private readonly wizardBridge: SetupWizardBridge,
    private readonly initializationService: InitializationService,
    private readonly nodeConfigRepository: NodeConfigRepository,
    private readonly envService: EnvService,
  ) {}

  async onModuleInit(): Promise<void> {
    // 1. Check existing config
    this.initializationService.checkConfigAndEmit();
    const status = this.initializationService.getNodeStatus();

    // 2. Already configured — fire bridge immediately
    if (status.isConfigured) {
      this.logger.log('✅ Node already configured — firing bridge');
      // Read the actual databaseUrl from the node config, not status.nodeId
      const config = this.nodeConfigRepository.find();
      const databaseUrl = config?.databaseUrl ?? process.env.SETUP_DATABASE_URL ?? '';
      this.wizardBridge.emit({
        databaseUrl,
        strategy: status.strategy ?? 'local',
        nodeId: status.nodeId ?? '',
      });
      this.wizardBridge.complete();
      return;
    }

    // 3. SETUP_AUTO=true — Phase 0 should have already persisted node_config
    // Check process.env directly since Docker Compose passes SETUP_AUTO via environment
    this.logger.debug(`process.env.SETUP_AUTO = "${process.env.SETUP_AUTO}"`);
    const setupAuto = process.env.SETUP_AUTO === "true";

    if (setupAuto) {
      this.logger.log('🧪 SETUP_AUTO=true — Phase 0 setup detected, auto-triggering local initialization');

      const devEmail = process.env.DEFAULT_ADMIN_EMAIL ?? 'admin@admin.com';
      const devPassword = process.env.DEFAULT_ADMIN_PASSWORD ?? 'adminadmin';
      const devName = process.env.DEFAULT_ADMIN_NAME ?? 'Admin';
      const devOrgName = process.env.DEFAULT_ADMIN_ORGANIZATION ?? 'My Organization';
      const serverUrl = process.env.NEXT_PUBLIC_API_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? '3001'}`;

      this.initializationService.triggerInitialize({
        strategy: 'local',
        name: devName,
        email: devEmail,
        password: devPassword,
        organizationName: devOrgName,
        serverUrl,
      });

      // Set up non-blocking listener for initialization completion
      // (Don't await — onModuleInit must return immediately)
      this.initializationService.getInitializeStream().pipe(
        filter((e: any) => e.type === 'completed'),
        take(1),
      ).subscribe({
        next: () => {
          this.initializationService.waitForSetup()
            .then((setupStatus) => {
              this.logger.log('✅ SETUP_AUTO local initialization completed — firing bridge');
              this.wizardBridge.emit({
                databaseUrl: setupStatus.databaseUrl ?? '',
                strategy: setupStatus.strategy ?? 'local',
                nodeId: setupStatus.nodeId ?? '',
              });
              this.wizardBridge.complete();
            })
            .catch((err) => {
              this.logger.error('SETUP_AUTO failed', err);
            });
        },
        error: (err) => {
          this.logger.error('SETUP_AUTO stream error', err);
        },
      });
      return;
    }

    // 5. No config — set up listener on initialization stream WITHOUT blocking
    //    CRITICAL: Do NOT await here. onModuleInit() must return immediately so
    //    NestFactory.create() can complete and app.init() can register routes
    //    (including /setup/*). If we block here, we create a chicken-and-egg
    //    deadlock: the setup wizard waits for the API, the API waits for route
    //    registration, route registration waits for module init, module init
    //    waits for the setup wizard.
    this.logger.log('📋 Setup wizard required — waiting for completion...');
    this.initializationService.getInitializeStream().pipe(
      filter((e: any) => e.type === 'completed'),
      take(1),
    ).subscribe({
      next: () => {
        this.initializationService.waitForSetup()
          .then((setupStatus) => {
            this.logger.log('✅ Setup wizard completed — firing bridge');
            this.wizardBridge.emit({
              databaseUrl: setupStatus.databaseUrl ?? '',
              strategy: setupStatus.strategy ?? 'local',
              nodeId: setupStatus.nodeId ?? '',
            });
            this.wizardBridge.complete();
          })
          .catch((err) => {
            this.logger.error('Setup wizard setup failed', err);
          });
      },
      error: (err) => {
        this.logger.error('Setup wizard stream error', err);
      },
    });
  }
}
