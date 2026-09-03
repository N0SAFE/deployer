import { Test, type TestingModule } from '@nestjs/testing';
import { InitializationService } from './initialization.service';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { NodeConfigRepository } from '../repositories/node-config.repository';
import { LocalInitializationService } from './local-initialization.service';
import { RemoteInitializationService } from './remote-initialization.service';
import { SetupEventService } from './setup-event.service';
import { MeshInitializationService } from '../../mesh/initialization/services/mesh-initialization.service';
import { ReachabilityService } from '../../reachability/services/reachability.service';

describe('InitializationService', () => {
  let service: InitializationService;

  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        InitializationService,
        {
          provide: NodeConfigRepository,
          useFactory: () => ({
            find: vi.fn(),
            save: vi.fn(),
            update: vi.fn(),
          }),
        },
        {
          provide: LocalInitializationService,
          useFactory: () => ({ initialize: vi.fn() }),
        },
        {
          provide: RemoteInitializationService,
          useFactory: () => ({ initialize: vi.fn() }),
        },
        {
          provide: SetupEventService,
          useFactory: () => ({ emit: vi.fn(), setupState: vi.fn() }),
        },
        {
          provide: MeshInitializationService,
          useFactory: () => ({
            bootstrap: vi.fn(),
            connectToMesh: vi.fn(),
            getMeshNodeUrls: vi.fn(),
          }),
        },
        {
          provide: ReachabilityService,
          useFactory: () => ({ checkMeshUrlReachability: vi.fn() }),
        },
      ],
    }).compile();

    service = module.get<InitializationService>(InitializationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkConfigAndEmit', () => {
    it('emits a completed status for an already-configured node', async () => {
      const repo = module.get(NodeConfigRepository);
      vi.mocked(repo.find).mockReturnValue({
        nodeId: 'n1',
        strategy: 'local' as const,
        setupState: 'setup_done' as const,
        databaseUrl: 'postgresql://existing@localhost:5432/db',
        configuredAt: '2026-01-01T00:00:00.000Z',
        meshUrlsSnapshot: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never);

      service.checkConfigAndEmit();

      const status = await service.waitForSetup();
      expect(status.strategy).toBe('local');
      expect(status.databaseUrl).toContain('postgresql://existing');
      expect(status.nodeId).toBe('n1');
    });
  });
});
