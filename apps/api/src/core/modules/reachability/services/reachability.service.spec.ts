import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeConfigRepository } from '@/core/modules/setup/repositories/node-config.repository';
import { NodeNetworkConfigRepository } from '../repositories/node-network-config.repository';
import { ReachabilityService } from './reachability.service';

describe('ReachabilityService', () => {
  let service: ReachabilityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReachabilityService,
        {
          provide: NodeNetworkConfigRepository,
          useValue: {
            findByNodeId: vi.fn().mockResolvedValue(null),
            list: vi.fn().mockResolvedValue([]),
            upsert: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: NodeConfigRepository,
          useValue: { find: vi.fn(() => ({ nodeId: '00000000-0000-0000-0000-000000000001' })) },
        },
      ],
    }).compile();

    service = module.get<ReachabilityService>(ReachabilityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
