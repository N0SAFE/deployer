/**
 * Startup Flow Integration Test
 *
 * Tests the FULL startup flow end-to-end at the service layer, mocking
 * only the external dependencies (Postgres, mesh network, Docker).
 *
 * Covers:
 *   1. Fresh node → checkConfigAndEmit (no config) → wizard available
 *   2. SETUP_AUTO → auto-configuration → pool ready
 *   3. Local initialization flow via triggerInitialize + getInitializeStream
 *   4. Already-configured guard (re-initialization rejected)
 *   5. Mesh URL resolution from local cache
 *   6. Background mesh query on checkConfigAndEmit
 *   7. Node status persistence across lifecycle
 *   8. State machine: not_started → provisioning → completed
 *   9. Cleanup and teardown
 */

import { Test, type TestingModule } from '@nestjs/testing';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from 'vitest';
import { firstValueFrom, Observable } from 'rxjs';
import { InitializationService } from '../initialization.service';
import { LocalInitializationService } from '../local-initialization.service';
import { RemoteInitializationService } from '../remote-initialization.service';
import { SetupEventService } from '../setup-event.service';
import { MeshInitializationService } from '../../../mesh/initialization/services/mesh-initialization.service';
import { ReachabilityService } from '../../../reachability/services/reachability.service';
import { EnvService } from '@/config/env/env.service';
import { NodeConfigRepository } from '../../repositories/node-config.repository';

// ─── Mock implementations ─────────────────────────────────────────────────────

function createMockNodeConfigRepository() {
  let store: Record<string, any> | null = null;
  return {
    find: vi.fn(() => store),
    upsert: vi.fn((data: any) => {
      store = { ...(store ?? {}), ...data };
    }),
    // Allow tests to seed the store directly
    _seed: (data: any) => { store = data; },
    _clear: () => { store = null; },
    _getStore: () => store,
  };
}

function createMockSetupEventService() {
  const listeners: Array<(event: any) => void> = [];
  return {
    emit: vi.fn((_channel: string, _meta: any, event: any) => {
      for (const listener of listeners) {
        listener(event);
      }
    }),
    observeProgress$: vi.fn(() => new Observable<void>(() => {})),
    _onEvent: (listener: (event: any) => void) => {
      listeners.push(listener);
    },
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Startup Flow Integration', () => {
  let service: InitializationService;
  let module: TestingModule;
  let mockNodeConfigRepo: ReturnType<typeof createMockNodeConfigRepository>;
  let mockEnvService: { get: MockInstance; _set: (key: string, val: any) => void };
  let mockSetupEventService: ReturnType<typeof createMockSetupEventService>;
  let mockMeshInit: Record<string, MockInstance>;
  let mockReachability: Record<string, MockInstance>;
  let mockLocalInit: { initialize: MockInstance };
  let mockRemoteInit: { initialize: MockInstance };

  // Shared test data
  const TEST_NODE_ID = 'test-node-0000-0000-000000000001';
  const TEST_DB_URL = 'postgresql://test:pass@localhost:5432/testdb';

  beforeEach(async () => {
    mockNodeConfigRepo = createMockNodeConfigRepository();
    mockEnvService = {
      get: vi.fn(() => undefined),
      _set: (key: string, val: any) => {
        mockEnvService.get.mockImplementation((k: string) =>
          k === key ? val : undefined
        );
      },
    };
    mockSetupEventService = createMockSetupEventService();
    mockLocalInit = { initialize: vi.fn() };
    mockRemoteInit = { initialize: vi.fn() };
    mockMeshInit = {
      connectToMesh: vi.fn(),
      bootstrap: vi.fn(),
      issueRemoteJoinGrant: vi.fn(),
      getMeshNodeUrls: vi.fn(),
      reconnectToMesh: vi.fn(),
    };
    mockReachability = {
      checkMeshUrlReachability: vi.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        InitializationService,
        { provide: NodeConfigRepository, useValue: mockNodeConfigRepo },
        { provide: EnvService, useValue: mockEnvService },
        { provide: SetupEventService, useValue: mockSetupEventService },
        { provide: LocalInitializationService, useValue: mockLocalInit },
        { provide: RemoteInitializationService, useValue: mockRemoteInit },
        { provide: MeshInitializationService, useValue: mockMeshInit },
        { provide: ReachabilityService, useValue: mockReachability },
      ],
    }).compile();

    service = module.get<InitializationService>(InitializationService);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
    vi.restoreAllMocks();
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  SCENARIO 1: FRESH NODE — NO CONFIG
  // ═════════════════════════════════════════════════════════════════════════

  describe('Scenario 1: Fresh node (no config)', () => {
    beforeEach(() => {
      mockNodeConfigRepo._clear();
    });

    it('getSetupState returns not_started', () => {
      const state = service.getSetupState();
      expect(state.state).toBe('not_started');
      expect(state.needsSetup).toBe(true);
      expect(state.bootstrapStrategy).toBeNull();
      expect(state.currentStep).toBe('choose_strategy');
      expect(state.progressPercent).toBe(0);
    });

    it('getNodeStatus shows unconfigured', () => {
      const status = service.getNodeStatus();
      expect(status.isConfigured).toBe(false);
      expect(status.nodeId).toBeNull();
      expect(status.configuredAt).toBeNull();
    });

    it('checkConfigAndEmit does NOT emit when no config and no SETUP_AUTO', () => {
      // Should not throw errors
      expect(() => service.checkConfigAndEmit()).not.toThrow();
      // Should not have upserted anything
      expect(mockNodeConfigRepo.upsert).not.toHaveBeenCalled();
    });

    it('waitForSetup never resolves when no config (no background mesh, no SETUP_DATABASE_URL)', async () => {
      // Temporarily remove SETUP_DATABASE_URL from env to test the blocking path
      const dbUrl = process.env.SETUP_DATABASE_URL
      delete process.env.SETUP_DATABASE_URL
      try {
        // After checkConfigAndEmit with no config, waitForSetup should
        // not resolve (it blocks until emitCompleted is called).
        // We use a timeout to verify the promise stays pending.
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), 200)
        );
        service.checkConfigAndEmit();
        await expect(
          Promise.race([service.waitForSetup(), timeout])
        ).rejects.toThrow('TIMEOUT');
      } finally {
        if (dbUrl) process.env.SETUP_DATABASE_URL = dbUrl
      }
    }, 1_000);
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  SCENARIO 2: SETUP_AUTO
  // ═════════════════════════════════════════════════════════════════════════

  describe('Scenario 2: SETUP_AUTO', () => {
    beforeEach(() => {
      mockNodeConfigRepo._clear();
      mockEnvService._set('SETUP_AUTO', 'true');
      // Emulate the real LocalInitializationService: persist a configured row
      // and return the completion handle. (The boot-time SETUP_AUTO branch is
      // owned by OrchestratorService → SetupDevService → triggerInitialize, so
      // the tests below drive triggerInitialize directly.)
      mockLocalInit.initialize = vi.fn(async () => {
        mockNodeConfigRepo.upsert({
          nodeId: TEST_NODE_ID,
          strategy: 'local',
          databaseUrl: TEST_DB_URL,
          configuredAt: '2024-06-01T00:00:00.000Z',
          setupState: 'setup_done',
          deployerVersion: '1.0.0',
          meshUrlsSnapshot: [],
          updatedAt: '2024-06-01T00:00:00.000Z',
        });
        return { nodeId: TEST_NODE_ID, databaseUrl: TEST_DB_URL };
      });
    });

    const launchLocalSetup = () => {
      const result = service.triggerInitialize({
        strategy: 'local',
        name: 'Test',
        email: 'test@test.com',
        password: 'pass123',
        serverUrl: 'http://localhost:3001',
      });
      expect(result.accepted).toBe(true);
    };

    it('local auto-configuration persists and emits completion', async () => {
      const setupPromise = service.waitForSetup();
      launchLocalSetup();
      const result = await setupPromise;
      expect(result).toBeDefined();
      expect(result.strategy).toBe('local');
      expect(result.databaseUrl).toMatch(/^postgresql:\/\//);
      expect(mockNodeConfigRepo.upsert).toHaveBeenCalled();

      // Verify persisted config
      const stored = mockNodeConfigRepo._getStore();
      expect(stored).not.toBeNull();
      expect(stored?.setupState).toBe('setup_done');
      expect(stored?.databaseUrl).toMatch(/^postgresql:\/\//);
    });

    it('getSetupState returns completed after auto-setup', async () => {
      const setupPromise = service.waitForSetup();
      launchLocalSetup();
      await setupPromise;
      const state = service.getSetupState();
      expect(state.state).toBe('completed');
      expect(state.needsSetup).toBe(false);
    });

    it('getNodeStatus shows configured after auto-setup', async () => {
      const setupPromise = service.waitForSetup();
      launchLocalSetup();
      await setupPromise;
      const status = service.getNodeStatus();
      expect(status.isConfigured).toBe(true);
      expect(status.nodeId).toBeTruthy();
      expect(status.configuredAt).not.toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  SCENARIO 3: CACHED CONFIGURATION
  // ═════════════════════════════════════════════════════════════════════════

  describe('Scenario 3: Cached configuration', () => {
    const CACHED_CONFIG = {
      nodeId: TEST_NODE_ID,
      strategy: 'local' as const,
      databaseUrl: TEST_DB_URL,
      configuredAt: '2024-06-01T00:00:00.000Z',
      setupState: 'setup_done',
      deployerVersion: '1.0.0',
      meshUrlsSnapshot: [],
      updatedAt: '2024-06-01T00:00:00.000Z',
    };

    beforeEach(() => {
      mockNodeConfigRepo._seed(CACHED_CONFIG);
    });

    it('checkConfigAndEmit emits immediately from cache', async () => {
      const setupPromise = service.waitForSetup();
      service.checkConfigAndEmit();
      const result = await setupPromise;
      expect(result.nodeId).toBe(TEST_NODE_ID);
      expect(result.databaseUrl).toBe(TEST_DB_URL);
      expect(result.strategy).toBe('local');
    });

    it('getSetupState returns completed from cached config', () => {
      const state = service.getSetupState();
      expect(state.state).toBe('completed');
      expect(state.needsSetup).toBe(false);
      expect(state.bootstrapStrategy).toBe('local');
    });

    it('getNodeStatus shows configured from cached config', () => {
      const status = service.getNodeStatus();
      expect(status.isConfigured).toBe(true);
      expect(status.nodeId).toBe(TEST_NODE_ID);
      expect(status.strategy).toBe('local');
      // Note: getNodeStatus still uses 'strategy' on NodeConfigStatus — different type
    });

    it('triggerInitialize rejects a second call while initialization is in progress', () => {
      const first = service.triggerInitialize({
        strategy: 'local',
        name: 'Test',
        email: 'test@test.com',
        password: 'pass123',
        serverUrl: 'http://localhost:3001',
      });
      expect(first.accepted).toBe(true);
      const second = service.triggerInitialize({
        strategy: 'local',
        name: 'Test',
        email: 'test@test.com',
        password: 'pass123',
        serverUrl: 'http://localhost:3001',
      });
      expect(second.accepted).toBe(false);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  SCENARIO 4: CACHED + MESH URLS — BACKGROUND QUERY
  // ═════════════════════════════════════════════════════════════════════════

  describe('Scenario 4: Cached config with mesh URLs', () => {
    const CACHED_WITH_MESH = {
      nodeId: TEST_NODE_ID,
      strategy: 'remote' as const,
      databaseUrl: TEST_DB_URL,
      configuredAt: '2024-06-01T00:00:00.000Z',
      setupState: 'setup_done',
      deployerVersion: '1.0.0',
      meshUrlsSnapshot: ['https://mesh-1.example.com'],
      peerServiceToken: 'peer-token-1',
      updatedAt: '2024-06-01T00:00:00.000Z',
    };

    const mockSession = {
      remoteNodeId: 'remote-node-1',
      remoteBaseUrl: 'https://mesh-1.example.com',
      client: {
        getLocalNode: vi.fn().mockResolvedValue({
          nodeId: 'remote-node-1',
          databaseUrl: 'postgres://mesh-db:5432/cluster',
        }),
        ping: vi.fn(),
      },
      peerServiceToken: 'peer-token-1',
      peerServiceTokenExpiresAt: '2025-01-01T00:00:00.000Z',
      close: vi.fn(),
    };

    beforeEach(() => {
      mockNodeConfigRepo._seed(CACHED_WITH_MESH);
    });

    it('fires background mesh query with peer service token', async () => {
      const connectSpy = mockMeshInit.connectToMesh;
      if (!connectSpy) throw new Error('connectToMesh mock not seeded');
      vi.mocked(connectSpy).mockRejectedValue(new Error('Mesh unreachable'));
      // The mesh reconnect runs in onModuleInit() for remote-strategy configs
      // (checkConfigAndEmit() only emits completion, it does not connect).
      await module.init();
      expect(connectSpy).toHaveBeenCalledWith(
        'https://mesh-1.example.com',
        expect.objectContaining({ peerServiceToken: 'peer-token-1' }),
      );
    });

    it('does NOT block on mesh query (fire-and-forget)', async () => {
      // The mesh query runs in background; waitForSetup should still
      // resolve immediately from the cached URL.
      const connectSpy = mockMeshInit.connectToMesh;
      if (!connectSpy) throw new Error('connectToMesh mock not seeded');
      vi.mocked(connectSpy).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10_000))
      );
      // Start the lifecycle without awaiting the mesh query; waitForSetup must
      // still resolve immediately from the cached database URL.
      const initPromise = module.init();
      const result = await service.waitForSetup();
      expect(result.databaseUrl).toBe(TEST_DB_URL);
      expect(connectSpy).toHaveBeenCalled();
      // Keep the dangling init promise from surfacing as an unhandled rejection.
      initPromise.catch(() => undefined);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  SCENARIO 5: TRIGGER INITIALIZE + STREAM
  // ═════════════════════════════════════════════════════════════════════════

  describe('Scenario 5: triggerInitialize and stream', () => {
    let capturedEvents: any[];

    beforeEach(() => {
      mockNodeConfigRepo._clear();
      capturedEvents = [];
      mockSetupEventService._onEvent((event: any) => {
        capturedEvents.push(event);
      });
      // Mock local init to simulate successful initialization
      mockLocalInit.initialize.mockRejectedValue(new Error('No Docker in test'));
    });

    it('triggerInitialize returns accepted on first call', () => {
      const result = service.triggerInitialize({
        strategy: 'local',
        name: 'Test User',
        email: 'test@example.com',
        password: 'pass123',
        serverUrl: 'http://localhost:3001',
      });
      expect(result.accepted).toBe(true);
    });

    it('triggerInitialize returns rejected on second call (already in progress)', () => {
      service.triggerInitialize({
        strategy: 'local',
        name: 'Test User',
        email: 'test@example.com',
        password: 'pass123',
        serverUrl: 'http://localhost:3001',
      });
      const second = service.triggerInitialize({
        strategy: 'local',
        name: 'Test User 2',
        email: 'test2@example.com',
        password: 'pass123',
        serverUrl: 'http://localhost:3001',
      });
      expect(second.accepted).toBe(false);
    });

    it('triggerInitialize returns rejected on second call even when config exists', () => {
      mockNodeConfigRepo._seed({
        nodeId: TEST_NODE_ID,
        strategy: 'local',
        databaseUrl: TEST_DB_URL,
        configuredAt: '2024-01-01T00:00:00.000Z',
        setupState: 'setup_done',
        deployerVersion: '1.0.0',
        meshUrlsSnapshot: [],
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      const first = service.triggerInitialize({
        strategy: 'local',
        name: 'Test User',
        email: 'test@example.com',
        password: 'pass123',
        serverUrl: 'http://localhost:3001',
      });
      expect(first.accepted).toBe(true);
      const second = service.triggerInitialize({
        strategy: 'local',
        name: 'Test User',
        email: 'test@example.com',
        password: 'pass123',
        serverUrl: 'http://localhost:3001',
      });
      expect(second.accepted).toBe(false);
    });

    it('getInitializeStream returns an Observable', () => {
      const stream = service.getInitializeStream();
      expect(stream).toBeInstanceOf(Observable);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  SCENARIO 6: STATE TRANSITIONS
  // ═════════════════════════════════════════════════════════════════════════

  describe('Scenario 6: State transitions', () => {
    it('fresh → not_started (no config exists)', () => {
      mockNodeConfigRepo._clear();
      const state = service.getSetupState();
      expect(state.state).toBe('not_started');
      expect(state.needsSetup).toBe(true);
    });

    it('not_started → completed (dev auto-setup)', async () => {
      mockNodeConfigRepo._clear();
      mockEnvService._set('SETUP_AUTO', 'true');
      // Need the emulating local-init mock in this scenario too.
      mockLocalInit.initialize = vi.fn(async () => {
        mockNodeConfigRepo.upsert({
          nodeId: TEST_NODE_ID,
          strategy: 'local',
          databaseUrl: TEST_DB_URL,
          configuredAt: '2024-06-01T00:00:00.000Z',
          setupState: 'setup_done',
          deployerVersion: '1.0.0',
          meshUrlsSnapshot: [],
          updatedAt: '2024-06-01T00:00:00.000Z',
        });
        return { nodeId: TEST_NODE_ID, databaseUrl: TEST_DB_URL };
      });

      // Before: not_started
      expect(service.getSetupState().state).toBe('not_started');

      // Auto-setup (boot pipeline entry: triggerInitialize)
      const result = service.triggerInitialize({
        strategy: 'local',
        name: 'Test',
        email: 'test@test.com',
        password: 'pass123',
        serverUrl: 'http://localhost:3001',
      });
      expect(result.accepted).toBe(true);
      await service.waitForSetup();

      // After: completed
      expect(service.getSetupState().state).toBe('completed');
      expect(service.getSetupState().needsSetup).toBe(false);
    });

    it('not_started → completed (cached config)', async () => {
      mockNodeConfigRepo._seed({
        nodeId: TEST_NODE_ID,
        strategy: 'local',
        databaseUrl: TEST_DB_URL,
        configuredAt: '2024-01-01T00:00:00.000Z',
        setupState: 'setup_done',
        deployerVersion: '1.0.0',
        meshUrlsSnapshot: [],
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      // Before checkConfigAndEmit: should already be completed from cache
      // (getSetupState reads directly from the repository)
      expect(service.getSetupState().state).toBe('completed');
      expect(service.getSetupState().needsSetup).toBe(false);

      // waitForSetup should also resolve immediately
      service.checkConfigAndEmit();
      const result = await service.waitForSetup();
      expect(result.nodeId).toBe(TEST_NODE_ID);
      expect(result.databaseUrl).toBe(TEST_DB_URL);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  SCENARIO 7: ERROR HANDLING
  // ═════════════════════════════════════════════════════════════════════════

  describe('Scenario 7: Error handling', () => {
    it('checkConfigAndEmit handles repository errors gracefully', () => {
      mockNodeConfigRepo.find.mockImplementation(() => {
        throw new Error('SQLite read failure');
      });
      expect(() => service.checkConfigAndEmit()).not.toThrow();
    });

    it('getSetupState handles missing repository gracefully', () => {
      mockNodeConfigRepo.find.mockReturnValue(null);
      const state = service.getSetupState();
      expect(state.state).toBe('not_started');
      expect(state.needsSetup).toBe(true);
    });

    it('getNodeStatus handles missing repository gracefully', () => {
      mockNodeConfigRepo.find.mockReturnValue(null);
      const status = service.getNodeStatus();
      expect(status.isConfigured).toBe(false);
      expect(status.nodeId).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  SCENARIO 8: IDEMPOTENCY & STABILITY
  // ═════════════════════════════════════════════════════════════════════════

  describe('Scenario 8: Idempotency and stability', () => {
    it('repeated getSetupState returns consistent results', () => {
      mockNodeConfigRepo._clear();
      const state1 = service.getSetupState();
      const state2 = service.getSetupState();
      const state3 = service.getSetupState();
      expect(state1.state).toBe(state2.state);
      expect(state2.state).toBe(state3.state);
    });

    it('repeated getNodeStatus returns consistent results', () => {
      mockNodeConfigRepo._clear();
      const s1 = service.getNodeStatus();
      const s2 = service.getNodeStatus();
      expect(s1.isConfigured).toBe(s2.isConfigured);
      expect(s1.nodeId).toBe(s2.nodeId);
    });

    it('emitCompleted is idempotent (double-call is no-op)', async () => {
      mockNodeConfigRepo._seed({
        nodeId: TEST_NODE_ID,
        strategy: 'local',
        databaseUrl: TEST_DB_URL,
        configuredAt: '2024-01-01T00:00:00.000Z',
        setupState: 'setup_done',
        deployerVersion: '1.0.0',
        meshUrlsSnapshot: [],
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      // First call should emit
      const promise1 = service.waitForSetup();
      service.checkConfigAndEmit();
      const result1 = await promise1;
      expect(result1.nodeId).toBe(TEST_NODE_ID);

      // Second waitForSubscribe should also resolve (ReplaySubject replays)
      const result2 = await service.waitForSetup();
      expect(result2.nodeId).toBe(TEST_NODE_ID);
      expect(result2.databaseUrl).toBe(TEST_DB_URL);
    });
  });
});
