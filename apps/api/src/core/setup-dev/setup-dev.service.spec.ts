import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SetupDevService } from './setup-dev.service';
import { EnvService } from "@/config/env/env.service";
import { NodeConfigRepository } from '../modules/setup/repositories/node-config.repository';

// ─── NodeConfigRepository mock ───────────────────────────────────────────────

function createMockNodeConfigRepository() {
  let store: Record<string, any> | null = null;
  return {
    find: vi.fn(() => store),
    upsert: vi.fn((data: any) => {
      store = { ...(store ?? {}), ...data };
    }),
    _seed: (data: any) => { store = data; },
    _clear: () => { store = null; },
    _getStore: () => store,
  };
}

describe('SetupDevService — global DB is MANDATORY (no local-only mode)', () => {
  let service: SetupDevService;
  let module: TestingModule;
  let repo: ReturnType<typeof createMockNodeConfigRepository>;

  const OLD_NODE_ENV = process.env.NODE_ENV;
  const OLD_SETUP_AUTO = process.env.SETUP_AUTO;
  const OLD_URL = process.env.SETUP_AUTO_DATABASE_URL;
  const OLD_LEGACY_URL = process.env.SETUP_DATABASE_URL;

  beforeEach(async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SETUP_AUTO;
    delete process.env.SETUP_AUTO_DATABASE_URL;
    delete process.env.SETUP_DATABASE_URL;

    repo = createMockNodeConfigRepository();
    module = await Test.createTestingModule({
      providers: [
        SetupDevService,
        { provide: NodeConfigRepository, useValue: repo },
        { provide: EnvService, useValue: { get: () => undefined } },
      ],
    }).compile();
    service = module.get<SetupDevService>(SetupDevService);
  });

  afterEach(() => {
    process.env.NODE_ENV = OLD_NODE_ENV;
    if (OLD_SETUP_AUTO === undefined) delete process.env.SETUP_AUTO;
    else process.env.SETUP_AUTO = OLD_SETUP_AUTO;
    if (OLD_URL === undefined) delete process.env.SETUP_AUTO_DATABASE_URL;
    else process.env.SETUP_AUTO_DATABASE_URL = OLD_URL;
    if (OLD_LEGACY_URL === undefined) delete process.env.SETUP_DATABASE_URL;
    else process.env.SETUP_DATABASE_URL = OLD_LEGACY_URL;

    // Managed-env switches are set per-test (no cross-test leakage).
    for (const k of [
      'MANAGED_GLOBAL_DB_ENABLED',
      'MANAGED_GLOBAL_DB_URL',
      'MANAGED_GLOBAL_DB_HOST',
      'MANAGED_GLOBAL_DB_PORT',
      'MANAGED_GLOBAL_DB_USER',
      'MANAGED_GLOBAL_DB_PASSWORD',
      'MANAGED_GLOBAL_DB_NAME',
    ]) {
      delete process.env[k];
    }
  });

  it('keeps an already-persisted URL (dev bootstrap skipped)', async () => {
    repo._seed({
      nodeId: 'n1',
      strategy: 'local',
      setupState: 'setup_done',
      databaseUrl: 'postgresql://existing@localhost:5432/db',
      configuredAt: '2026-01-01T00:00:00.000Z',
      meshUrlsSnapshot: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await service.onApplicationBootstrap();

    expect(repo.upsert).not.toHaveBeenCalled();
    expect(repo._getStore()?.databaseUrl).toBe('postgresql://existing@localhost:5432/db');
  });

  it('FAILS HARD when SETUP_AUTO requests an unreachable database (no local-only fallback)', async () => {
    process.env.SETUP_AUTO = 'true';
    process.env.SETUP_AUTO_DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/definitely_down';

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /refusing to start without a global database/
    );
    // NOTHING is persisted — no local-only config.
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('uses the legacy SETUP_DATABASE_URL alias when the new var is absent', async () => {
    process.env.SETUP_AUTO = 'true';
    process.env.SETUP_DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/legacy_down';

    await expect(service.onApplicationBootstrap()).rejects.toThrow(/unreachable/);
  });

  it('persists NOTHING for SETUP_AUTO without a URL — wizard auto-provisions instead', async () => {
    process.env.SETUP_AUTO = 'true';

    await service.onApplicationBootstrap();

    // No local-only write, no setup_done with empty URL — the wizard must
    // provision the container.
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(repo._getStore()).toBeNull();
  });

  it('skips everything when not in dev', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SETUP_AUTO = 'true';
    process.env.SETUP_AUTO_DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/x';

    await service.onApplicationBootstrap();

    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('persists a compose-managed DB as a SETUP CANDIDATE, not setup_done (provided DB ≠ setup done)', async () => {
    process.env.MANAGED_GLOBAL_DB_ENABLED = 'true';
    process.env.MANAGED_GLOBAL_DB_HOST = 'global-db';
    process.env.MANAGED_GLOBAL_DB_PORT = '5432';
    process.env.MANAGED_GLOBAL_DB_USER = 'deployer';
    process.env.MANAGED_GLOBAL_DB_PASSWORD = 'deployer';
    process.env.MANAGED_GLOBAL_DB_NAME = 'deployer';

    const svc = new SetupDevService(
      repo as unknown as NodeConfigRepository,
      { get: (k: string) => process.env[k] } as unknown as EnvService,
    );
    (svc as unknown as { probe(): Promise<boolean> }).probe = async () => true;

    await svc.onApplicationBootstrap();

    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseUrl: expect.stringContaining('postgresql://'),
        // The core assertion: a provided DB must NOT auto-complete setup.
        setupState: 'not_started',
        databaseProvisioning: 'external',
      }),
    );
    expect(repo._getStore()?.configuredAt).toBeUndefined();
  });

  it('does not downgrade an already-configured node when MANAGED_GLOBAL_DB_ENABLED=true', async () => {
    repo._seed({
      nodeId: 'n1',
      strategy: 'local',
      setupState: 'setup_done',
      databaseUrl: 'postgresql://deployer:deployer@global-db:5432/deployer',
      databaseProvisioning: 'external',
      configuredAt: '2026-01-01T00:00:00.000Z',
      meshUrlsSnapshot: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    process.env.MANAGED_GLOBAL_DB_ENABLED = 'true';

    const svc = new SetupDevService(
      repo as unknown as NodeConfigRepository,
      { get: (k: string) => process.env[k] } as unknown as EnvService,
    );

    await svc.onApplicationBootstrap();

    expect(repo.upsert).not.toHaveBeenCalled();
    expect(repo._getStore()?.setupState).toBe('setup_done');
  });
});