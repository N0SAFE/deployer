import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseModule } from './database.module';
import { GLOBAL_DATABASE_CONNECTION } from './database-connection';
import { GlobalDatabaseService } from './global/global-database.service';
import { LocalDatabaseService } from './local/local-database.service';

describe('DatabaseModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [DatabaseModule],
    })
    .compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should provide GlobalDatabaseService', () => {
    const globalDatabaseService = module.get(GlobalDatabaseService);
    expect(globalDatabaseService).toBeDefined();
  });
  
  it('should provide LocalDatabaseService', () => {
    const localDatabaseService = module.get(LocalDatabaseService);
    expect(localDatabaseService).toBeDefined();
  });

  it('should provide GLOBAL_DATABASE_CONNECTION', () => {
    const globalConnection = module.get(GLOBAL_DATABASE_CONNECTION);
    expect(globalConnection).toBeDefined();
  });
  
  it('should provide GLOBAL_DATABASE_POOL', () => {
    const pool = module.get('GLOBAL_DATABASE_POOL');
    expect(pool).toBeDefined();
  });
  
  it('should provide LOCAL_DATABASE_CONNECTION', () => {
    const localConnection = module.get('LOCAL_DATABASE_CONNECTION');
    expect(localConnection).toBeDefined();
  });
});