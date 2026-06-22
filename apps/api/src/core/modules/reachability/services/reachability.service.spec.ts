import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReachabilityService } from './reachability.service';

describe('ReachabilityService', () => {
  let service: ReachabilityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReachabilityService],
    }).compile();

    service = module.get<ReachabilityService>(ReachabilityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
