import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { defaultIngressLanes, type IngressLanes } from '@deployer/contracts-entities/entities/ingress/index';
import { NodeConfigRepository } from "@deployer/nest-nodes/node-config.repository";

import { EgressRequestError, EgressService } from '../../egress/egress.service';
import { EdgeProviderRegistry } from '../../edge/edge-provider.registry';
import { TEST_TUNNEL_ID, testEdgeRegistry, type TestTunnelEdgeProvider } from '../../edge/testing/edge-registry.fixture';
import { IngressLanesService } from '../../platform-ingress/services/ingress-lanes.service';
import { NodeNetworkConfigRepository } from '../repositories/node-network-config.repository';
import { PublicEdgeService } from './public-edge.service';
import { ReachabilityService } from './reachability.service';

const tunnelLane = { provider: TEST_TUNNEL_ID, domain: 'apps.example.com', acknowledgedInboundPorts: false, options: { account: 'acc-1' } };
const directLane = (tls: boolean) => ({ provider: 'direct', domain: 'apps.example.com', acknowledgedInboundPorts: true, options: { tls } });

describe('ReachabilityService', () => {
  let service: ReachabilityService;
  let lanes: IngressLanes;
  let tunnel: TestTunnelEdgeProvider;
  let egress: { external: Mock; operator: Mock; fixedExternal: Mock; probeHttp: Mock };

  beforeEach(async () => {
    lanes = defaultIngressLanes();
    const edges = testEdgeRegistry();
    tunnel = edges.tunnel;
    const env = { get: vi.fn(() => '') };
    egress = { external: vi.fn(), operator: vi.fn(), fixedExternal: vi.fn(), probeHttp: vi.fn(() => vi.fn()) };
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
        { provide: EgressService, useValue: egress },
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

  describe('outbound requests go through the egress policy', () => {
    const body = (text: string) => ({ status: 200, headers: {}, url: '', body: new TextEncoder().encode(text) });
    const denied = () => new EgressRequestError('Target not allowed by the network policy', 'external');

    it('getPublicIp asks only the fixed echo hosts, with no redirects of its own choosing', async () => {
      egress.fixedExternal.mockResolvedValueOnce(body('203.0.113.7\n'));
      expect(await service.getPublicIp()).toBe('203.0.113.7');
      expect(egress.fixedExternal).toHaveBeenCalledWith({ url: 'https://checkip.amazonaws.com' }, ['checkip.amazonaws.com']);
    });

    it('getPublicIp ignores an answer that is not an IP and tries the next host', async () => {
      egress.fixedExternal.mockResolvedValueOnce(body('<html>captive portal</html>')).mockResolvedValueOnce(body('198.51.100.9'));
      expect(await service.getPublicIp()).toBe('198.51.100.9');
      expect(egress.fixedExternal).toHaveBeenCalledTimes(2);
    });

    it('getPublicIp is null when every host is refused or down', async () => {
      egress.fixedExternal.mockRejectedValue(denied());
      expect(await service.getPublicIp()).toBeNull();
    });

    it('verifyPublicAddress probes through the external policy', async () => {
      await service.verifyPublicAddress('203.0.113.10');
      expect(egress.probeHttp).toHaveBeenCalledWith('external');
    });

    it('checkMeshUrlReachability probes through the operator policy', async () => {
      await service.checkMeshUrlReachability('http://10.0.0.5:3005');
      expect(egress.probeHttp).toHaveBeenCalledWith('operator');
    });

    it('a refused mesh target is unreachable with the generic reason, not a resolved address', async () => {
      egress.probeHttp.mockReturnValue(() => Promise.reject(new EgressRequestError('Target not allowed by the network policy', 'operator')));
      const result = await service.checkMeshUrlReachability('http://169.254.169.254');
      expect(result.reachable).toBe(false);
      expect(result.error).toBe('Target not allowed by the network policy');
    });

    it('checkDomainReachability: the DNS-over-HTTPS name is URL-encoded, not interpolated', async () => {
      egress.fixedExternal.mockResolvedValue(body('{"Answer":[{"data":"203.0.113.1"},{"data":"not-an-ip"}]}'));
      egress.external.mockRejectedValue(denied());
      // a name that would inject a parameter if it were concatenated into the query
      const result = await service.checkDomainReachability('nx-domain.invalid&type=TXT');
      const url = new URL((egress.fixedExternal.mock.calls[0]?.[0] as { url: string }).url);
      expect(url.hostname).toBe('dns.google');
      expect(url.searchParams.get('name')).toBe('nx-domain.invalid&type=TXT');
      expect(url.searchParams.get('type')).toBe('A');
      expect(result.resolvedIps).toEqual(['203.0.113.1']);
    });

    it('checkDomainReachability: a refused HTTP probe means not reachable, over https then http', async () => {
      egress.fixedExternal.mockRejectedValue(denied());
      egress.external.mockRejectedValue(denied());
      const result = await service.checkDomainReachability('internal.corp.example');
      expect(result.httpReachable).toBe(false);
      expect(egress.external).toHaveBeenCalledTimes(2);
      expect(egress.external.mock.calls.map(([req]) => (req as { url: string }).url)).toEqual(['https://internal.corp.example', 'http://internal.corp.example']);
    });

    it('checkDomainReachability: any HTTP status counts as reachable', async () => {
      egress.fixedExternal.mockRejectedValue(denied());
      egress.external.mockResolvedValueOnce({ ...body(''), status: 404 });
      const result = await service.checkDomainReachability('app.example.com');
      expect(result.httpReachable).toBe(true);
      expect(result.httpStatusCode).toBe(404);
    });
  });
});
