import { Test, type TestingModule } from '@nestjs/testing';
import { InitializationService } from './initialization.service';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { NodeConfigRepository, type NodeConfigRepositoryShape } from "@deployer/node-state"
import { LocalInitializationService } from './local-initialization.service';
import { RemoteInitializationService } from './remote-initialization.service';
import { SetupEventService } from './setup-event.service';
import { MeshInitializationService } from '../../mesh/initialization/services/mesh-initialization.service';
import { ReachabilityService } from '../../reachability/services/reachability.service';
import { Effect } from "effect";
import { AppLifecycle } from '@deployer/lifecycle';

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
            find: vi.fn(() => Effect.succeed(null)),
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
        {
          // Setup completion advances the lifecycle, which is what readiness
          // READS. Stubbed here so the unit tests stay isolated from it.
          provide: AppLifecycle,
          useFactory: () => ({
            markReadyNow: vi.fn(),
            markDatabaseProbeNow: vi.fn(),
            markMeshConnectedNow: vi.fn(),
          }),
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
      const repo = module.get<NodeConfigRepositoryShape>(NodeConfigRepository);
      vi.mocked(repo.find).mockReturnValue(Effect.succeed({
        nodeId: 'n1',
        strategy: 'local' as const,
        setupState: 'setup_done' as const,
        databaseUrl: 'postgresql://existing@localhost:5432/db',
        configuredAt: '2026-01-01T00:00:00.000Z',
        meshUrlsSnapshot: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }) as never);

      await service.checkConfigAndEmit();

      const status = await service.waitForSetup();
      expect(status.strategy).toBe('local');
      expect(status.databaseUrl).toContain('postgresql://existing');
      expect(status.nodeId).toBe('n1');
    });
  });

  /**
   * SEC-012 / SETUP-002 — `/setup/*` is anonymous and must not stay a mutation
   * surface once the node is configured.
   */
  describe('assertSetupMutable', () => {
    const setConfig = (row: unknown) =>
      vi.mocked(module.get<NodeConfigRepositoryShape>(NodeConfigRepository).find)
        .mockReturnValue(Effect.succeed(row) as never);

    const completed = {
      nodeId: 'n1',
      strategy: 'local',
      setupState: 'setup_done',
      databaseUrl: 'postgresql://deployer:pw@db.example.com:5432/deployer',
      configuredAt: '2026-01-01T00:00:00.000Z',
    };

    it('refuses a mutation once setup is complete', async () => {
      setConfig(completed);

      await expect(service.assertSetupMutable()).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('allows a mutation while setup is in progress', async () => {
      setConfig({ ...completed, setupState: 'setup_in_progress', configuredAt: null, databaseUrl: null });

      await expect(service.assertSetupMutable()).resolves.toBeUndefined();
    });

    it('allows a mutation on a fresh node', async () => {
      setConfig(null);

      await expect(service.assertSetupMutable()).resolves.toBeUndefined();
    });
  });

  describe('assertDatabaseProbeAllowed', () => {
    const setConfig = (row: unknown) =>
      vi.mocked(module.get<NodeConfigRepositoryShape>(NodeConfigRepository).find)
        .mockReturnValue(Effect.succeed(row) as never);

    it.each([
      ['loopback IPv4', 'postgresql://u:p@127.0.0.1:5432/db'],
      ['private IPv4', 'postgresql://u:p@10.1.2.3:5432/db'],
      ['cloud metadata', 'postgresql://u:p@169.254.169.254/db'],
      ['loopback name', 'postgresql://u:p@localhost:5432/db'],
    ])('refuses a %s target', async (_label, url) => {
      setConfig(null);

      await expect(service.assertDatabaseProbeAllowed(url)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('allows a public address', async () => {
      setConfig(null);

      await expect(service.assertDatabaseProbeAllowed('postgresql://u:p@93.184.216.34:5432/db'))
        .resolves.toBeUndefined();
    });

    it("allows the platform's own database, even on loopback", async () => {
      const url = 'postgresql://u:p@127.0.0.1:5432/deployer';
      setConfig({
        nodeId: 'n1',
        strategy: 'local',
        setupState: 'setup_done',
        databaseUrl: url,
        configuredAt: '2026-01-01T00:00:00.000Z',
      });

      await expect(service.assertDatabaseProbeAllowed(url)).resolves.toBeUndefined();
    });
  });
});
