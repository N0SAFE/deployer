import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseModule } from './database.module';
import { GlobalDatabaseService } from './services/global-database.service';
import { GLOBAL_DATABASE_CONNECTION } from './database-connection';

describe('DatabaseModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [DatabaseModule],
    })
    .overrideProvider(GLOBAL_DATABASE_CONNECTION)
    .useValue({
      execute: vi.fn(),
    })
    .compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should provide GlobalDatabaseService', () => {
    const databaseService = module.get<GlobalDatabaseService>(GlobalDatabaseService);
    expect(databaseService).toBeDefined();
  });

  it('should provide GLOBAL_DATABASE_CONNECTION', () => {
    const connection = module.get(GLOBAL_DATABASE_CONNECTION);
    expect(connection).toBeDefined();
  });
});