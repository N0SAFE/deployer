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
});