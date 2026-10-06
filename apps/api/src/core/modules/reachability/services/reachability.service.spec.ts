import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository";
import { NodeNetworkConfigRepository } from '../repositories/node-network-config.repository';
import { PlatformIngressSettingsService } from '@/core/modules/platform-ingress/services/platform-ingress-settings.service';
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
        {
          // The STACK edge: no tunnel, `direct` mode — the default install.
          provide: PlatformIngressSettingsService,
          useValue: {
            getEdgeMode: vi.fn().mockResolvedValue('direct'),
            getEdgeTunnel: vi.fn().mockResolvedValue({
              token: null,
              tunnelId: null,
              providerId: null,
              wildcard: null,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ReachabilityService>(ReachabilityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
