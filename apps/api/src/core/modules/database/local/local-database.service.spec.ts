import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { LocalDatabaseService } from './local-database.service';

describe('LocalDatabaseService', () => {
  let service: LocalDatabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LocalDatabaseService],
    }).compile();

    service = module.get<LocalDatabaseService>(LocalDatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
