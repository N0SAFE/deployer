import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultIngressLanes, type IngressLanes } from '@deployer/contracts-entities/entities/ingress/index';
import { NodeConfigRepository } from "@deployer/nest-nodes/node-config.repository";

import { EdgeProviderRegistry } from '@/core/modules/edge/edge-provider.registry';
import { TEST_TUNNEL_ID, testEdgeRegistry, type TestTunnelEdgeProvider } from '@/core/modules/edge/testing/edge-registry.fixture';
import { IngressLanesService } from '@/core/modules/platform-ingress/services/ingress-lanes.service';
import { NodeNetworkConfigRepository } from '@/core/modules/reachability/repositories/node-network-config.repository';
import { PublicEdgeService } from '@/core/modules/reachability/services/public-edge.service';
import { ReachabilityService } from '@/core/modules/reachability/services/reachability.service';

const tunnelLane = { provider: TEST_TUNNEL_ID, domain: 'apps.example.com', acknowledgedInboundPorts: false, options: { account: 'acc-1' } };
const directLane = (tls: boolean) => ({ provider: 'direct', domain: 'apps.example.com', acknowledgedInboundPorts: true, options: { tls } });

describe('ReachabilityService', () => {
  let service: ReachabilityService;
  let lanes: IngressLanes;
  let tunnel: TestTunnelEdgeProvider;

  beforeEach(async () => {
    lanes = defaultIngressLanes();
    const edges = testEdgeRegistry();
    tunnel = edges.tunnel;
    const env = { get: vi.fn(() => '') };
    const nodeConfigs = {
      findByNodeId: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReachabilityService,
        { provide: NodeNetworkConfigRepository, useValue: nodeConfigs },
        { provide: NodeConfigRepository, useValue: { find: vi.fn(() => ({ nodeId: '00000000-0000-0000-0000-000000000001' })) } },
        { provide: IngressLanesService, useValue: { getLanes: vi.fn(() => Promise.resolve(lanes)) } },
        { provide: EdgeProviderRegistry, useValue: edges.registry },
        {
          provide: PublicEdgeService,
          useFactory: () => new PublicEdgeService(edges.registry, nodeConfigs as unknown as NodeNetworkConfigRepository, env as never),
        },
      ],
    }).compile();

    service = module.get<ReachabilityService>(ReachabilityService);
  });

  describe('getNodePublicUrl', () => {
    it('is null on a local-only install — nothing is on the internet', async () => {
      expect(await service.getNodePublicUrl()).toBeNull();
    });

    it('is the API host on the public domain over https when the edge terminates TLS (never the unrouted apex)', async () => {
      lanes = { ...lanes, public: tunnelLane };
      expect(await service.getNodePublicUrl()).toBe('https://api.apps.example.com');
    });

    it('follows the edge provider for plain HTTP', async () => {
      lanes = { ...lanes, public: directLane(false) };
      expect(await service.getNodePublicUrl()).toBe('http://api.apps.example.com');
      lanes = { ...lanes, public: directLane(true) };
      expect(await service.getNodePublicUrl()).toBe('https://api.apps.example.com');
    });

    it('is null when the console is private, even with a public lane', async () => {
      lanes = { ...lanes, consoleVisibility: 'private', public: tunnelLane };
      expect(await service.getNodePublicUrl()).toBeNull();
    });
  });

  describe('checkDomainGate', () => {
    it('lets a local-only install prepare its domains', async () => {
      expect((await service.checkDomainGate()).allowed).toBe(true);
    });

    it('allows domains once the public edge reports itself provisioned', async () => {
      lanes = { ...lanes, public: tunnelLane };
      expect((await service.checkDomainGate()).allowed).toBe(true);
    });

    it("blocks domains while the public edge is not provisioned, with the provider's own reason", async () => {
      lanes = { ...lanes, public: directLane(true) };
      const gate = await service.checkDomainGate();
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toMatch(/public IP/);
    });

    it('blocks domains on a lane whose provider is not registered here', async () => {
      tunnel.provisioned = true;
      lanes = { ...lanes, public: { ...tunnelLane, provider: 'gone-provider' } };
      const gate = await service.checkDomainGate();
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toContain('gone-provider');
    });
  });
});
