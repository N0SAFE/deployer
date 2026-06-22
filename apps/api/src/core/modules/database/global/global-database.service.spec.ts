import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalDatabaseService } from './global-database.service';

describe('GlobalDatabaseService', () => {
  let service: GlobalDatabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GlobalDatabaseService],
    }).compile();

    service = module.get<GlobalDatabaseService>(GlobalDatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
