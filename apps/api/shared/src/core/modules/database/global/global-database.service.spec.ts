import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach } from "vitest";

import { GlobalDatabaseService } from './global-database.service';

import type { TestingModule } from '@nestjs/testing';

describe('GlobalDatabaseService', () => {
  let service: GlobalDatabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [{ provide: GlobalDatabaseService, useFactory: () => new GlobalDatabaseService() }],
    }).compile();

    service = module.get<GlobalDatabaseService>(GlobalDatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
