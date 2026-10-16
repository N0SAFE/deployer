import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GLOBAL_DATABASE_CONNECTION, LOCAL_DATABASE_CONNECTION } from "@deployer/nest-database-core/database-connection";
import { GlobalDatabaseService } from '@/core/modules/database/global/global-database.service';
import { LocalDatabaseService } from "@deployer/nest-database-local/local-database.service";

// Mock heavy sub-modules that trigger env validation and real DB connections
vi.mock('./global/global-database.module', () => ({
  GlobalDatabaseModule: {
    global: true,
    module: class {},
    providers: [
      { provide: 'GLOBAL_DATABASE_POOL', useValue: {} },
      { provide: GlobalDatabaseService, useValue: { db: { execute: vi.fn() } } },
      { provide: GLOBAL_DATABASE_CONNECTION, useValue: { execute: vi.fn() } },
    ],
    exports: ['GLOBAL_DATABASE_POOL', GlobalDatabaseService, GLOBAL_DATABASE_CONNECTION],
  },
}));
vi.mock("@deployer/nest-database-local/local-database.module", () => {
  const providesLocalDatabase = {
    module: class {},
    providers: [
      { provide: LOCAL_DATABASE_CONNECTION, useValue: {} },
      { provide: LocalDatabaseService, useValue: {} },
    ],
    exports: [LOCAL_DATABASE_CONNECTION, LocalDatabaseService],
  };
  return {
    LocalDatabaseModule: {
      global: true,
      ...providesLocalDatabase,
      // `forRootAsync` MUST be present. The app does not import this class bare —
      // it imports the wrapper (`@/core/modules/database/local/local-database.module`),
      // whose `localDatabaseRegistration()` calls `forRootAsync` at decoration time.
      // A stub without it fails the suite at COLLECTION with
      // "LocalDatabaseModule.forRootAsync is not a function", before any assertion.
      forRootAsync: vi.fn().mockReturnValue({ global: true, ...providesLocalDatabase }),
    },
  };
});
vi.mock('@deployer/nest-lifecycle', () => ({
  // `forRoot` MUST be present: `@Global() @Module({})` classes provide NOTHING
  // when imported bare, so `DatabaseModule` imports this module through
  // `forRoot()` — a stub that omits it fails at import time with
  // "AppLifecycleModule.forRoot is not a function" before any assertion runs.
  AppLifecycleModule: {
    forRoot: vi.fn().mockReturnValue({ module: class {}, global: true }),
  },
}));
vi.mock('./services/database-startup-guard.service', () => ({
  DatabaseStartupGuard: class {},
}));
vi.mock('./services/database-probe.service', () => ({
  DatabaseProbeService: class {},
}));
vi.mock('./services/database-failure-tracker.service', () => ({
  DatabaseFailureTracker: class {},
}));

import { DatabaseModule } from '@/core/modules/database/database.module';

describe('DatabaseModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [DatabaseModule],
    })
    .overrideProvider(GLOBAL_DATABASE_CONNECTION)
    .useValue({ execute: vi.fn() })
    .overrideProvider('GLOBAL_DATABASE_POOL')
    .useValue({})
    .compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should provide GlobalDatabaseService', () => {
    expect(module.get(GlobalDatabaseService)).toBeDefined();
  });

  it('should provide LocalDatabaseService', () => {
    expect(module.get(LocalDatabaseService)).toBeDefined();
  });

  it('should provide GLOBAL_DATABASE_CONNECTION', () => {
    expect(module.get(GLOBAL_DATABASE_CONNECTION)).toBeDefined();
  });

  it('should provide LOCAL_DATABASE_CONNECTION', () => {
    expect(module.get(LOCAL_DATABASE_CONNECTION)).toBeDefined();
  });
});