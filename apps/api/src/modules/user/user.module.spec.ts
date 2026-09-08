import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserController } from '@/modules/user/controllers/user.controller';
import { UserService } from '@/modules/user/services/user.service';
import { UserRepository } from '@/modules/user/repositories/user.repository';

// Mock DatabaseModule to avoid ConfigModule.forRoot({ validate }) env validation
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
vi.mock('@/core/modules/configuration/configuration-core.module', () => ({
  ConfigurationCoreModule: { module: class {} },
}));

describe('UserModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        UserService,
        {
          provide: UserRepository,
          useValue: { find: vi.fn(), create: vi.fn(), findByEmail: vi.fn() },
        },
      ],
    })
    .compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should provide UserController', () => {
    const controller = module.get<UserController>(UserController);
    expect(controller).toBeDefined();
  });

  it('should provide UserService', () => {
    const service = module.get<UserService>(UserService);
    expect(service).toBeDefined();
  });

  it('should provide UserRepository', () => {
    const repository = module.get<UserRepository>(UserRepository);
    expect(repository).toBeDefined();
  });
});