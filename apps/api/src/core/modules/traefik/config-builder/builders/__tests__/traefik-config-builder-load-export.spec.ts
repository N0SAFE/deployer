import { describe, it, expect } from 'vitest';
import { TraefikConfigBuilder } from '../traefik-config-builder';
import type { TraefikConfig } from '../../types';

describe('TraefikConfigBuilder Load & Export', () => {
  describe('static load()', () => {
    it('should load from simple YAML string', () => {
      const yaml = `
http:
  routers:
    my-router:
      rule: "Host(\`example.com\`)"
      service: my-service
      entryPoints:
        - web
`;

      const builder = TraefikConfigBuilder.load(yaml);
      const config = builder.build();

      expect(config.http?.routers).toBeDefined();
      expect(config.http?.routers?.['my-router']).toEqual({
        rule: 'Host(`example.com`)',
        service: 'my-service',
        entryPoints: ['web'],
      });
    });

    it('should load from complex YAML string with all features', () => {
      const yaml = `
http:
  routers:
    web-router:
      rule: "Host(\`example.com\`) && PathPrefix(\`/api\`)"
      service: api-service
      entryPoints:
        - websecure
      middlewares:
        - auth
        - cors
      tls:
        certResolver: letsencrypt
  services:
    api-service:
      loadBalancer:
        servers:
          - url: "http://localhost:3000"
        healthCheck:
          path: /health
          interval: 10s
  middlewares:
    auth:
      basicAuth:
        users:
          - "admin:$apr1$..."
    cors:
      headers:
        accessControlAllowOriginList:
          - "*"
tls:
  certificates:
    - certFile: /certs/cert.pem
      keyFile: /certs/key.pem
  options:
    default:
      minVersion: VersionTLS12
`;

      const builder = TraefikConfigBuilder.load(yaml);
      const config = builder.build();

      // Verify router
      expect(config.http?.routers?.['web-router']).toBeDefined();
      expect(config.http?.routers?.['web-router']?.rule).toBe(
        'Host(`example.com`) && PathPrefix(`/api`)'
      );
      expect(config.http?.routers?.['web-router']?.middlewares).toEqual(['auth', 'cors']);

      // Verify service
      expect(config.http?.services?.['api-service']).toBeDefined();
      expect(config.http?.services?.['api-service']?.loadBalancer?.servers).toHaveLength(1);

      // Verify middlewares
      expect(config.http?.middlewares?.auth).toBeDefined();
      expect(config.http?.middlewares?.cors).toBeDefined();

      // Verify TLS
      expect(config.tls?.certificates).toHaveLength(1);
      expect(config.tls?.options?.default?.minVersion).toBe('VersionTLS12');
    });

    it('should load from JSON string', () => {
      const json = JSON.stringify({
        http: {
          routers: {
            'json-router': {
              rule: 'Host(`json.example.com`)',
              service: 'json-service',
              entryPoints: ['web'],
            },
          },
          services: {
            'json-service': {
              loadBalancer: {
                servers: [{ url: 'http://backend:8080' }],
              },
            },
          },
        },
      });

      const builder = TraefikConfigBuilder.load(json);
      const config = builder.build();

      expect(config.http?.routers?.['json-router']).toBeDefined();
      expect(config.http?.services?.['json-service']).toBeDefined();
    });

    it('should load from TraefikConfig object', () => {
      const configObj: TraefikConfig = {
        http: {
          routers: {
            'obj-router': {
              rule: 'Host(`object.example.com`)',
              service: 'obj-service',
            },
          },
        },
      };

      const builder = TraefikConfigBuilder.load(configObj);
      const config = builder.build();

      expect(config.http?.routers?.['obj-router']).toEqual(configObj.http?.routers?.['obj-router']);
    });

    it('should throw error for invalid YAML/JSON', () => {
      // Use a truly invalid structure that both parsers will reject
      const invalidInput = '{ invalid: json: structure: }';

      expect(() => TraefikConfigBuilder.load(invalidInput)).toThrow();
    });

    it('should load routers with all properties', () => {
      const yaml = `
http:
  routers:
    full-router:
      rule: "Host(\`full.example.com\`)"
      service: full-service
      entryPoints:
        - web
        - websecure
      middlewares:
        - middleware1
        - middleware2
      priority: 100
      tls:
        certResolver: myresolver
        domains:
          - main: "*.example.com"
            sans:
              - "example.com"
`;

      const builder = TraefikConfigBuilder.load(yaml);
      const config = builder.build();
      const router = config.http?.routers?.['full-router'];

      expect(router).toBeDefined();
      expect(router?.entryPoints).toEqual(['web', 'websecure']);
      expect(router?.middlewares).toEqual(['middleware1', 'middleware2']);
      expect(router?.priority).toBe(100);
      const tls = typeof router?.tls === 'object' ? router.tls : undefined;
      expect(tls?.certResolver).toBe('myresolver');
      expect(tls?.domains).toHaveLength(1);
    });

    it('should load services with health checks and sticky sessions', () => {
      const yaml = `
http:
  services:
    advanced-service:
      loadBalancer:
        servers:
          - url: "http://server1:8080"
          - url: "http://server2:8080"
        healthCheck:
          path: /health
          interval: 10s
          timeout: 3s
        sticky:
          cookie:
            name: lb
            secure: true
`;

      const builder = TraefikConfigBuilder.load(yaml);
      const config = builder.build();
      const service = config.http?.services?.['advanced-service'];

      expect(service?.loadBalancer?.servers).toHaveLength(2);
      expect(service?.loadBalancer?.healthCheck?.path).toBe('/health');
      expect(service?.loadBalancer?.sticky?.cookie?.name).toBe('lb');
    });

    it('should load weighted and mirroring services', () => {
      const yaml = `
http:
  services:
    weighted-service:
      weighted:
        services:
          - name: service1
            weight: 80
          - name: service2
            weight: 20
    mirror-service:
      mirroring:
        service: main-service
        mirrors:
          - name: mirror1
            percent: 50
`;

      const builder = TraefikConfigBuilder.load(yaml);
      const config = builder.build();

      expect(config.http?.services?.['weighted-service']?.weighted?.services).toHaveLength(2);
      expect(config.http?.services?.['mirror-service']?.mirroring?.service).toBe('main-service');
    });

    it('should load various middleware types', () => {
      const yaml = `
http:
  middlewares:
    auth-middleware:
      basicAuth:
        users:
          - "user:pass"
    cors-middleware:
      headers:
        accessControlAllowOriginList:
          - "https://example.com"
        accessControlAllowMethods:
          - GET
          - POST
    rate-limit-middleware:
      rateLimit:
        average: 100
        burst: 50
    compress-middleware:
      compress: {}
`;

      const builder = TraefikConfigBuilder.load(yaml);
      const config = builder.build();
      const middlewares = config.http?.middlewares;

      expect(middlewares?.['auth-middleware']?.basicAuth).toBeDefined();
      expect(middlewares?.['cors-middleware']?.headers).toBeDefined();
      expect(middlewares?.['rate-limit-middleware']?.rateLimit?.average).toBe(100);
      expect(middlewares?.['compress-middleware']?.compress).toBeDefined();
    });

    it('should load TLS with multiple certificates and options', () => {
      const yaml = `
tls:
  certificates:
    - certFile: /certs/cert1.pem
      keyFile: /certs/key1.pem
    - certFile: /certs/cert2.pem
      keyFile: /certs/key2.pem
      stores:
        - default
  options:
    default:
      minVersion: VersionTLS12
      maxVersion: VersionTLS13
      cipherSuites:
        - TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
    strict:
      minVersion: VersionTLS13
  stores:
    default:
      defaultCertificate:
        certFile: /certs/default-cert.pem
        keyFile: /certs/default-key.pem
`;

      const builder = TraefikConfigBuilder.load(yaml);
      const config = builder.build();
      const tls = config.tls;

      expect(tls?.certificates).toHaveLength(2);
      expect(tls?.options?.default?.minVersion).toBe('VersionTLS12');
      expect(tls?.options?.strict?.minVersion).toBe('VersionTLS13');
      expect(tls?.stores?.default?.defaultCertificate).toBeDefined();
    });

    it('should handle empty configuration', () => {
      const yaml = '{}';
      const builder = TraefikConfigBuilder.load(yaml);
      const config = builder.build();

      expect(config).toEqual({});
    });

    it('should handle partial configuration with only routers', () => {
      const yaml = `
http:
  routers:
    simple-router:
      rule: "Host(\`simple.com\`)"
      service: simple-service
`;

      const builder = TraefikConfigBuilder.load(yaml);
      const config = builder.build();

      expect(config.http?.routers).toBeDefined();
      expect(config.http?.services).toBeUndefined();
      expect(config.http?.middlewares).toBeUndefined();
    });
  });

  describe('static toYAMLString()', () => {
    it('should convert simple config to YAML', () => {
      const config: TraefikConfig = {
        http: {
          routers: {
            'test-router': {
              rule: 'Host(`test.com`)',
              service: 'test-service',
            },
          },
        },
      };

      const yaml = TraefikConfigBuilder.toYAMLString(config);

      expect(yaml).toContain('http:');
      expect(yaml).toContain('routers:');
      expect(yaml).toContain('test-router:');
      expect(yaml).toContain('rule:');
      expect(yaml).toContain('Host(`test.com`)');
    });

    it('should convert complex config to YAML', () => {
      const config: TraefikConfig = {
        http: {
          routers: {
            'web-router': {
              rule: 'Host(`example.com`)',
              service: 'web-service',
              entryPoints: ['web', 'websecure'],
              middlewares: ['auth', 'cors'],
            },
          },
          services: {
            'web-service': {
              loadBalancer: {
                servers: [
                  { url: 'http://server1:8080' },
                  { url: 'http://server2:8080' },
                ],
                healthCheck: {
                  path: '/health',
                  interval: '10s',
                },
              },
            },
          },
          middlewares: {
            auth: {
              basicAuth: {
                users: ['user:pass'],
              },
            },
          },
        },
        tls: {
          certificates: [
            {
              certFile: '/certs/cert.pem',
              keyFile: '/certs/key.pem',
            },
          ],
        },
      };

      const yaml = TraefikConfigBuilder.toYAMLString(config);

      // Verify structure
      expect(yaml).toContain('http:');
      expect(yaml).toContain('routers:');
      expect(yaml).toContain('services:');
      expect(yaml).toContain('middlewares:');
      expect(yaml).toContain('tls:');
      expect(yaml).toContain('certificates:');
    });

    it('should produce valid YAML that can be parsed back', () => {
      const originalConfig: TraefikConfig = {
        http: {
          routers: {
            'round-trip-router': {
              rule: 'PathPrefix(`/api`)',
              service: 'api-service',
            },
          },
          services: {
            'api-service': {
              loadBalancer: {
                servers: [{ url: 'http://api:3000' }],
              },
            },
          },
        },
      };

      // Convert to YAML
      const yaml = TraefikConfigBuilder.toYAMLString(originalConfig);

      // Parse back and verify
      const builder = TraefikConfigBuilder.load(yaml);
      const parsedConfig = builder.build();

      expect(parsedConfig.http?.routers?.['round-trip-router']).toEqual(
        originalConfig.http?.routers?.['round-trip-router']
      );
      expect(parsedConfig.http?.services?.['api-service']).toEqual(
        originalConfig.http?.services?.['api-service']
      );
    });
  });

  describe('Integration: Load, Modify, Export', () => {
    it('should load config, modify it, and export', () => {
      const yaml = `
http:
  routers:
    existing-router:
      rule: "Host(\`existing.com\`)"
      service: existing-service
  services:
    existing-service:
      loadBalancer:
        servers:
          - url: "http://existing:8080"
`;

      // Load existing config
      const builder = TraefikConfigBuilder.load(yaml);

      // Modify: add new router
      builder.addRouter('new-router', r =>
        r.rule('Host(`new.com`)').service('new-service').entryPoint('web')
      );

      // Modify: add new service
      builder.addService('new-service', s =>
        s.loadBalancer(lb => lb.server('http://new:9090'))
      );

      // Export to config
      const config = builder.build();

      // Verify both old and new exist
      expect(config.http?.routers?.['existing-router']).toBeDefined();
      expect(config.http?.routers?.['new-router']).toBeDefined();
      expect(config.http?.services?.['existing-service']).toBeDefined();
      expect(config.http?.services?.['new-service']).toBeDefined();
    });

    it('should load config with variables and compile', () => {
      const yaml = `
http:
  routers:
    var-router:
      rule: "Host(\`~##domain##~\`)"
      service: var-service
  services:
    var-service:
      loadBalancer:
        servers:
          - url: "http://~##containerName##~:~##port##~"
`;

      const builder = TraefikConfigBuilder.load(yaml);
      const context = {
        domain: 'production.example.com',
        containerName: 'web-app',
        port: 8080,
      };

      const compiled = builder.compile(context);

      expect(compiled.http?.routers?.['var-router']?.rule).toBe(
        'Host(`production.example.com`)'
      );
      expect(compiled.http?.services?.['var-service']?.loadBalancer?.servers?.[0]?.url).toBe(
        'http://web-app:8080'
      );
    });

    it('should support round-trip: build → YAML → load → build', () => {
      // Create initial config
      const builder1 = new TraefikConfigBuilder();
      builder1
        .addRouter('test-router', r => r.rule('Host(`test.com`)').service('test-svc'))
        .addService('test-svc', s => s.loadBalancer(lb => lb.server('http://backend:3000')))
        .addMiddleware('compress', m => m.compress());

      const config1 = builder1.build();

      // Convert to YAML
      const yaml = TraefikConfigBuilder.toYAMLString(config1);

      // Load from YAML
      const builder2 = TraefikConfigBuilder.load(yaml);
      const config2 = builder2.build();

      // Verify configs are identical
      expect(config2).toEqual(config1);
    });

    it('should allow modifying loaded config and preserving changes', () => {
      const yaml = `
http:
  routers:
    original:
      rule: "Host(\`original.com\`)"
      service: svc1
`;

      const builder = TraefikConfigBuilder.load(yaml);

      // Add middleware
      builder.addMiddleware('rate-limit', m => m.rateLimit({ average: 100 }));

      // Update router to use middleware (need to rebuild)
      builder.addRouter('original', r =>
        r.rule('Host(`original.com`)').service('svc1').middleware('rate-limit')
      );

      const config = builder.build();

      expect(config.http?.middlewares?.['rate-limit']).toBeDefined();
      expect(config.http?.routers?.original?.middlewares).toContain('rate-limit');
    });
  });

  describe('Edge Cases', () => {
    it('should handle config with only TLS', () => {
      const yaml = `
tls:
  certificates:
    - certFile: /cert.pem
      keyFile: /key.pem
`;

      const builder = TraefikConfigBuilder.load(yaml);
      const config = builder.build();

      expect(config.tls?.certificates).toHaveLength(1);
      expect(config.http).toBeUndefined();
    });

    it('should handle deeply nested structures', () => {
      const yaml = `
http:
  routers:
    nested-router:
      rule: "Host(\`nested.com\`)"
      service: nested-service
      tls:
        certResolver: resolver1
        domains:
          - main: "*.nested.com"
            sans:
              - "nested.com"
              - "www.nested.com"
              - "api.nested.com"
`;

      const builder = TraefikConfigBuilder.load(yaml);
      const config = builder.build();
      const router = config.http?.routers?.['nested-router'];
      const tls = typeof router?.tls === 'object' ? router.tls : undefined;

      expect(tls?.domains?.[0]?.sans).toHaveLength(3);
    });

    it('should handle special characters in YAML', () => {
      const yaml = `
http:
  middlewares:
    special-chars:
      basicAuth:
        users:
          - "user:$2y$10$abcdefg"
`;

      const builder = TraefikConfigBuilder.load(yaml);
      const config = builder.build();

      expect(config.http?.middlewares?.['special-chars']?.basicAuth?.users?.[0]).toContain('$2y$');
    });
  });
});
