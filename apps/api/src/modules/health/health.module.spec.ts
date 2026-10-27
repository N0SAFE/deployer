import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';

// Mock heavy modules that trigger env validation and real database connections.
// vi.mock is hoisted, so these apply BEFORE any import statements resolve.
vi.mock('@/core/modules/database/database.module', () => ({
  DatabaseModule: { global: true, module: class {} },
}));
vi.mock("@deployer/nest-database-core/database-connection", () => ({
  GLOBAL_DATABASE_CONNECTION: 'GLOBAL_DATABASE_CONNECTION',
  LOCAL_DATABASE_CONNECTION: 'LOCAL_DATABASE_CONNECTION',
}));
vi.mock('@/core/modules/database/services/global-database.service', () => ({
  GlobalDatabaseService: class {},
}));
vi.mock("@deployer/nest-supervisor-core/supervisors.module", () => ({
  SupervisorsModule: { module: class {} },
}));
vi.mock("@deployer/nest-supervisor-core/supervisor-orchestrator.service", () => ({
  SupervisorOrchestratorService: class {},
}));
vi.mock('@deployer/nest-lifecycle', () => ({
  AppLifecycleService: class { getSnapshot() { return { phase: 'running', step: null, message: '' }; } },
  AppLifecycleModule: { module: class {} },
}));

import { HealthController } from '@/modules/health/controllers/health.controller';
import { HealthService } from '@/modules/health/services/health.service';
import { HealthRepository } from '@/modules/health/repositories/health.repository';
import { ReadinessService } from '@/modules/health/services/readiness.service';
import { AppLifecycleService } from '@deployer/nest-lifecycle';
import { SupervisorOrchestratorService } from "@deployer/nest-supervisor-core/supervisor-orchestrator.service";

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
        {
          provide: ReadinessService,
          useValue: { probe: vi.fn().mockResolvedValue({ statusCode: 200, body: { status: 'ok', info: {}, checkedAt: new Date().toISOString() } }) },
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