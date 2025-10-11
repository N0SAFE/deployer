import { describe, it, expect } from 'vitest';
import { ServiceBuilder, LoadBalancerBuilder, HealthCheckBuilder } from '../service-builder';

describe('ServiceBuilder', () => {
  describe('LoadBalancer Service', () => {
    it('should build basic LoadBalancer service', () => {
      const { name, config } = new ServiceBuilder('api')
        .loadBalancer(lb => lb.server('http://api:3000'))
        .build();

      expect(name).toBe('api');
      expect(config).toMatchObject({
        loadBalancer: {
          servers: [{ url: 'http://api:3000' }],
        },
      });
    });

    it('should build LoadBalancer with multiple servers', () => {
      const { config } = new ServiceBuilder('api')
        .loadBalancer(lb => lb
          .server('http://api1:3000')
          .server('http://api2:3000')
          .server('http://api3:3000')
        )
        .build();

      expect(config.loadBalancer?.servers).toHaveLength(3);
      expect(config.loadBalancer?.servers).toEqual([
        { url: 'http://api1:3000' },
        { url: 'http://api2:3000' },
        { url: 'http://api3:3000' },
      ]);
    });

    it('should build LoadBalancer with weighted servers', () => {
      const { config } = new ServiceBuilder('api')
        .loadBalancer(lb => lb
          .server('http://api1:3000', 3)
          .server('http://api2:3000', 1)
        )
        .build();

      expect(config.loadBalancer?.servers).toEqual([
        { url: 'http://api1:3000', weight: 3 },
        { url: 'http://api2:3000', weight: 1 },
      ]);
    });

    it('should build LoadBalancer with servers array', () => {
      const { config } = new ServiceBuilder('api')
        .loadBalancer(lb => lb.servers([
          { url: 'http://api1:3000', weight: 2 },
          { url: 'http://api2:3000', weight: 1 },
        ]))
        .build();

      expect(config.loadBalancer?.servers).toHaveLength(2);
    });

    it('should support variables in server URLs', () => {
      const { config } = new ServiceBuilder('api')
        .loadBalancer(lb => lb
          .server('http://~##apiHost##~:~##apiPort##~')
        )
        .build();

      expect(config.loadBalancer?.servers[0].url).toBe('http://~##apiHost##~:~##apiPort##~');
    });
  });

  describe('Health Checks', () => {
    it('should add health check to LoadBalancer', () => {
      const { config } = new ServiceBuilder('api')
        .loadBalancer(lb => lb
          .server('http://api:3000')
          .healthCheck(hc => hc
            .path('/health')
            .interval('10s')
          )
        )
        .build();

      expect(config.loadBalancer?.healthCheck).toMatchObject({
        path: '/health',
        interval: '10s',
      });
    });

    it('should build comprehensive health check', () => {
      const { config } = new ServiceBuilder('api')
        .loadBalancer(lb => lb
          .server('http://api:3000')
          .healthCheck(hc => hc
            .path('/api/health')
            .interval('30s')
            .timeout('5s')
            .scheme('http')
            .port(3001)
            .hostname('api.local')
            .headers({ 'X-Health-Check': 'true' })
            .followRedirects(true)
          )
        )
        .build();

      expect(config.loadBalancer?.healthCheck).toMatchObject({
        path: '/api/health',
        interval: '30s',
        timeout: '5s',
        scheme: 'http',
        port: 3001,
        hostname: 'api.local',
        headers: { 'X-Health-Check': 'true' },
        followRedirects: true,
      });
    });

    it('should support variables in health check', () => {
      const { config } = new ServiceBuilder('api')
        .loadBalancer(lb => lb
          .server('http://api:3000')
          .healthCheck(hc => hc
            .path('~##healthPath##~')
            .interval('~##healthInterval##~')
          )
        )
        .build();

      expect(config.loadBalancer?.healthCheck?.path).toBe('~##healthPath##~');
      expect(config.loadBalancer?.healthCheck?.interval).toBe('~##healthInterval##~');
    });
  });

  describe('Sticky Sessions', () => {
    it('should add basic sticky session', () => {
      const { config } = new ServiceBuilder('api')
        .loadBalancer(lb => lb
          .server('http://api:3000')
          .sticky('session')
        )
        .build();

      expect(config.loadBalancer?.sticky).toMatchObject({
        cookie: {
          name: 'session',
        },
      });
    });

    it('should add sticky session with options', () => {
      const { config } = new ServiceBuilder('api')
        .loadBalancer(lb => lb
          .server('http://api:3000')
          .sticky('session', {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
          })
        )
        .build();

      expect(config.loadBalancer?.sticky?.cookie).toMatchObject({
        name: 'session',
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
      });
    });
  });

  describe('Pass Host Header', () => {
    it('should set passHostHeader', () => {
      const { config } = new ServiceBuilder('api')
        .loadBalancer(lb => lb
          .server('http://api:3000')
          .passHostHeader(false)
        )
        .build();

      expect(config.loadBalancer?.passHostHeader).toBe(false);
    });

    it('should default passHostHeader to true', () => {
      const { config } = new ServiceBuilder('api')
        .loadBalancer(lb => lb.server('http://api:3000'))
        .build();

      expect(config.loadBalancer?.passHostHeader).toBeUndefined();
    });
  });

  describe('Weighted Service', () => {
    it('should build weighted service', () => {
      const { config } = new ServiceBuilder('api')
        .weighted([
          { name: 'api-v1', weight: 3 },
          { name: 'api-v2', weight: 1 },
        ])
        .build();

      expect(config.weighted).toMatchObject({
        services: [
          { name: 'api-v1', weight: 3 },
          { name: 'api-v2', weight: 1 },
        ],
      });
    });

    it('should support variables in weighted service names', () => {
      const { config } = new ServiceBuilder('api')
        .weighted([
          { name: '~##primaryService##~', weight: 3 },
          { name: '~##canaryService##~', weight: 1 },
        ])
        .build();

      expect(config.weighted?.services[0].name).toBe('~##primaryService##~');
      expect(config.weighted?.services[1].name).toBe('~##canaryService##~');
    });
  });

  describe('Mirroring Service', () => {
    it('should build mirroring service', () => {
      const { config } = new ServiceBuilder('api')
        .mirroring('api-primary', [
          { name: 'api-mirror', percent: 10 },
        ])
        .build();

      expect(config.mirroring).toMatchObject({
        service: 'api-primary',
        mirrors: [
          { name: 'api-mirror', percent: 10 },
        ],
      });
    });

    it('should build mirroring with multiple mirrors', () => {
      const { config } = new ServiceBuilder('api')
        .mirroring('api-primary', [
          { name: 'api-mirror-1', percent: 10 },
          { name: 'api-mirror-2', percent: 5 },
        ])
        .build();

      expect(config.mirroring?.mirrors).toHaveLength(2);
    });

    it('should support variables in mirroring', () => {
      const { config } = new ServiceBuilder('api')
        .mirroring('~##primaryService##~', [
          { name: '~##mirrorService##~', percent: 10 },
        ])
        .build();

      expect(config.mirroring?.service).toBe('~##primaryService##~');
      expect(config.mirroring?.mirrors?.[0].name).toBe('~##mirrorService##~');
    });
  });

  describe('LoadBalancerBuilder', () => {
    it('should build LoadBalancer config directly', () => {
      const config = new LoadBalancerBuilder()
        .server('http://api1:3000')
        .server('http://api2:3000')
        .build();

      expect(config.servers).toHaveLength(2);
    });

    it('should chain all methods', () => {
      const config = new LoadBalancerBuilder()
        .server('http://api:3000')
        .healthCheck(hc => hc.path('/health'))
        .sticky('session')
        .passHostHeader(true)
        .build();

      expect(config).toMatchObject({
        servers: [{ url: 'http://api:3000' }],
        healthCheck: { path: '/health' },
        sticky: { cookie: { name: 'session' } },
        passHostHeader: true,
      });
    });
  });

  describe('HealthCheckBuilder', () => {
    it('should build HealthCheck config directly', () => {
      const config = new HealthCheckBuilder()
        .path('/health')
        .interval('10s')
        .timeout('5s')
        .build();

      expect(config).toMatchObject({
        path: '/health',
        interval: '10s',
        timeout: '5s',
      });
    });

    it('should support all health check options', () => {
      const config = new HealthCheckBuilder()
        .path('/api/health')
        .interval('30s')
        .timeout('10s')
        .scheme('https')
        .port(8443)
        .hostname('api.example.com')
        .headers({ 'Authorization': 'Bearer ~##token##~' })
        .followRedirects(false)
        .build();

      expect(config).toMatchObject({
        path: '/api/health',
        interval: '30s',
        timeout: '10s',
        scheme: 'https',
        port: 8443,
        hostname: 'api.example.com',
        headers: { 'Authorization': 'Bearer ~##token##~' },
        followRedirects: false,
      });
    });
  });

  describe('Real-World Scenarios', () => {
    it('should build production LoadBalancer with health check', () => {
      const { name, config } = new ServiceBuilder('api-production')
        .loadBalancer(lb => lb
          .server('http://api-1:3000', 2)
          .server('http://api-2:3000', 2)
          .server('http://api-3:3000', 1)
          .healthCheck(hc => hc
            .path('/health')
            .interval('10s')
            .timeout('3s')
          )
          .sticky('api-session', { httpOnly: true, secure: true })
        )
        .build();

      expect(name).toBe('api-production');
      expect(config.loadBalancer?.servers).toHaveLength(3);
      expect(config.loadBalancer?.healthCheck).toBeDefined();
      expect(config.loadBalancer?.sticky).toBeDefined();
    });

    it('should build canary deployment with weighted services', () => {
      const { config } = new ServiceBuilder('api-canary')
        .weighted([
          { name: 'api-stable', weight: 95 },
          { name: 'api-canary-v2', weight: 5 },
        ])
        .build();

      expect(config.weighted?.services[0]).toMatchObject({
        name: 'api-stable',
        weight: 95,
      });
      expect(config.weighted?.services[1]).toMatchObject({
        name: 'api-canary-v2',
        weight: 5,
      });
    });

    it('should build mirroring for testing', () => {
      const { config } = new ServiceBuilder('api-with-mirror')
        .mirroring('api-production', [
          { name: 'api-test', percent: 10 },
        ])
        .build();

      expect(config.mirroring).toMatchObject({
        service: 'api-production',
        mirrors: [{ name: 'api-test', percent: 10 }],
      });
    });
  });

  describe('Edge Cases', () => {
    it('should throw error if no service type configured', () => {
      expect(() => {
        new ServiceBuilder('empty').build();
      }).toThrow('Service must have at least one configuration');
    });

    it('should throw error with empty server list', () => {
      expect(() => {
        new ServiceBuilder('api')
          .loadBalancer(lb => lb.servers([]))
          .build();
      }).toThrow('LoadBalancer must have at least one server');
    });

    it('should preserve service name', () => {
      const { name } = new ServiceBuilder('my-api-service')
        .loadBalancer(lb => lb.server('http://api:3000'))
        .build();

      expect(name).toBe('my-api-service');
    });
  });
});
