import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';

// Mock heavy modules that trigger env validation and real database connections.
// vi.mock is hoisted, so these apply BEFORE any import statements resolve.
vi.mock('@/core/modules/database/database.module', () => ({
  DatabaseModule: { global: true, module: class {} },
}));
vi.mock('@/core/modules/database/database-connection', () => ({
  GLOBAL_DATABASE_CONNECTION: 'GLOBAL_DATABASE_CONNECTION',
  LOCAL_DATABASE_CONNECTION: 'LOCAL_DATABASE_CONNECTION',
}));
vi.mock('@/core/modules/database/services/global-database.service', () => ({
  GlobalDatabaseService: class {},
}));
vi.mock('@/core/modules/supervisors/supervisors.module', () => ({
  SupervisorsModule: { module: class {} },
}));
vi.mock('@/core/modules/supervisors/supervisor-shared', () => ({
  getSharedSupervisorEventBus: () => ({ on: vi.fn(), emit: vi.fn() }),
  getSharedSupervisorRegistry: () => ({ register: vi.fn(), get: vi.fn() }),
}));
vi.mock('@/core/modules/supervisors/supervisor-orchestrator.service', () => ({
  SupervisorOrchestratorService: class {},
}));
vi.mock('@repo/nest-lifecycle', () => ({
  AppLifecycleService: class { getSnapshot() { return { phase: 'running', step: null, message: '' }; } },
  AppLifecycleModule: { module: class {} },
}));

import { HealthController } from '@/modules/health/controllers/health.controller';
import { HealthService } from '@/modules/health/services/health.service';
import { HealthRepository } from '@/modules/health/repositories/health.repository';
import { AppLifecycleService } from '@repo/nest-lifecycle';
import { SupervisorOrchestratorService } from '@/core/modules/supervisors/supervisor-orchestrator.service';

describe('HealthModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: HealthRepository,
          useValue: { find: vi.fn(), create: vi.fn() },
        },
        {
          provide: AppLifecycleService,
          useValue: { getSnapshot: vi.fn().mockReturnValue({ phase: 'running', step: null, message: '' }) },
        },
        {
          provide: SupervisorOrchestratorService,
          useValue: {},
        },
      ],
    }).compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should provide HealthController', () => {
    const controller = module.get<HealthController>(HealthController);
    expect(controller).toBeDefined();
  });

  it('should provide HealthService', () => {
    const service = module.get<HealthService>(HealthService);
    expect(service).toBeDefined();
  });

  it('should provide HealthRepository', () => {
    const repository = module.get<HealthRepository>(HealthRepository);
    expect(repository).toBeDefined();
  });
});