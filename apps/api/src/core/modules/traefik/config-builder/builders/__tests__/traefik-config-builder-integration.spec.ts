import { describe, it, expect } from 'vitest';
import { TraefikConfigBuilder } from '../traefik-config-builder';
import type { VariableContext } from '../../variables';

describe('TraefikConfigBuilder Integration', () => {
  describe('Router Management', () => {
    it('should add HTTP router with builder function', () => {
      const builder = new TraefikConfigBuilder();
      
      builder.addRouter('api', router => 
        router
          .rule('Host(`api.example.com`)')
          .service('api-service')
      );

      const config = builder.build();
      expect(config.http?.routers?.api).toBeDefined();
      expect(config.http?.routers?.api?.rule).toBe('Host(`api.example.com`)');
      expect(config.http?.routers?.api?.service).toBe('api-service');
    });

    it('should add multiple HTTP routers', () => {
      const builder = new TraefikConfigBuilder();
      
      builder
        .addRouter('api', r => r.rule('Host(`api.example.com`)').service('api-service'))
        .addRouter('web', r => r.rule('Host(`example.com`)').service('web-service'));

      const config = builder.build();
      expect(config.http?.routers?.api).toBeDefined();
      expect(config.http?.routers?.web).toBeDefined();
    });
  });

  describe('Service Management', () => {
    it('should add HTTP service with builder function', () => {
      const builder = new TraefikConfigBuilder();
      
      builder.addService('api', service => 
        service.loadBalancer(lb => 
          lb.server('http://api:3000')
        )
      );

      const config = builder.build();
      expect(config.http?.services?.api).toBeDefined();
      expect(config.http?.services?.api?.loadBalancer?.servers).toHaveLength(1);
    });

    it('should add multiple HTTP services', () => {
      const builder = new TraefikConfigBuilder();
      
      builder
        .addService('api', s => s.loadBalancer(lb => lb.server('http://api:3000')))
        .addService('web', s => s.loadBalancer(lb => lb.server('http://web:8080')));

      const config = builder.build();
      expect(config.http?.services?.api).toBeDefined();
      expect(config.http?.services?.web).toBeDefined();
    });
  });

  describe('Middleware Management', () => {
    it('should add HTTP middleware with builder function', () => {
      const builder = new TraefikConfigBuilder();
      
      builder.addMiddleware('cors', middleware => 
        middleware.cors({
          origins: ['https://example.com'],
          methods: ['GET', 'POST'],
        })
      );

      const config = builder.build();
      expect(config.http?.middlewares?.cors).toBeDefined();
    });

    it('should add multiple HTTP middlewares', () => {
      const builder = new TraefikConfigBuilder();
      
      builder
        .addMiddleware('cors', m => m.cors({ origins: ['https://example.com'] }))
        .addMiddleware('auth', m => m.basicAuth(['user:pass']))
        .addMiddleware('rate-limit', m => m.rateLimit({ average: 100 }));

      const config = builder.build();
      expect(config.http?.middlewares?.cors).toBeDefined();
      expect(config.http?.middlewares?.auth).toBeDefined();
      expect(config.http?.middlewares?.['rate-limit']).toBeDefined();
    });
  });

  describe('TLS Configuration', () => {
    it('should set TLS configuration', () => {
      const builder = new TraefikConfigBuilder();
      
      builder.configureTLS(tls => 
        tls
          .certificate('/certs/cert.pem', '/certs/key.pem')
          .minVersion('VersionTLS12')
      );

      const config = builder.build();
      expect(config.tls?.certificates).toHaveLength(1);
      expect(config.tls?.options?.default?.minVersion).toBe('VersionTLS12');
    });
  });

  describe('Build Configuration', () => {
    it('should build empty configuration', () => {
      const builder = new TraefikConfigBuilder();
      const config = builder.build();

      expect(config).toEqual({});
    });

    it('should build configuration with all components', () => {
      const builder = new TraefikConfigBuilder();
      
      builder
        .addRouter('api', r => r.rule('Host(`api.example.com`)').service('api-service'))
        .addService('api-service', s => s.loadBalancer(lb => lb.server('http://api:3000')))
        .addMiddleware('cors', m => m.cors({ origins: ['*'] }))
        .configureTLS(tls => tls.certificate('/certs/cert.pem', '/certs/key.pem'));

      const config = builder.build();
      
      expect(config.http?.routers?.api).toBeDefined();
      expect(config.http?.services?.['api-service']).toBeDefined();
      expect(config.http?.middlewares?.cors).toBeDefined();
      expect(config.tls?.certificates).toHaveLength(1);
    });
  });

  describe('Compile with Variables', () => {
    it('should compile configuration with variables', () => {
      const builder = new TraefikConfigBuilder();
      
      builder.addRouter('api', r => 
        r.rule('Host(`~##domain##~`)')
          .service('~##serviceName##~')
      );

      const variables: VariableContext = {
        domain: 'api.example.com',
        serviceName: 'api-service',
      };

      const config = builder.compile(variables);
      
      expect(config.http?.routers?.api?.rule).toBe('Host(`api.example.com`)');
      expect(config.http?.routers?.api?.service).toBe('api-service');
    });

    it('should compile with nested variables', () => {
      const builder = new TraefikConfigBuilder();
      
      builder
        .addService('api', s => s.loadBalancer(lb => 
          lb.server('http://~##host##~:~##port##~')
        ))
        .addMiddleware('rate-limit', m => m.rateLimit({ 
          average: '~##rateLimit##~' as any 
        }));

      const variables: VariableContext = {
        host: 'api.local',
        port: 3000,
        rateLimit: 100,
      };

      const config = builder.compile(variables);
      
      expect(config.http?.services?.api?.loadBalancer?.servers?.[0].url)
        .toBe('http://api.local:3000');
      // String templates resolve to strings, even if the variable value is a number
      expect(config.http?.middlewares?.['rate-limit']?.rateLimit?.average).toBe('100');
    });

    it('should throw error for undefined variable', () => {
      const builder = new TraefikConfigBuilder();
      
      builder.addRouter('api', r => 
        r.rule('Host(`~##undefinedVar##~`)')
          .service('api-service')
      );

      const variables: VariableContext = {};

      expect(() => builder.compile(variables)).toThrow();
    });
  });

  describe('Preview Configuration', () => {
    it('should preview configuration with variables', () => {
      const builder = new TraefikConfigBuilder();
      
      builder.addRouter('api', r => 
        r.rule('Host(`~##domain##~`)')
          .service('~##serviceName##~')
      );

      const variables: VariableContext = {
        domain: 'api.example.com',
      };

      const preview = builder.preview(variables);
      
      expect(preview.found).toContain('domain');
      expect(preview.missing).toContain('serviceName');
      expect(preview.total).toBeGreaterThan(0);
    });
  });

  describe('JSON Export', () => {
    it('should export compiled config to JSON', () => {
      const builder = new TraefikConfigBuilder();
      
      builder.addRouter('api', r => 
        r.rule('Host(`~##domain##~`)')
          .service('api-service')
      );

      const variables: VariableContext = {
        domain: 'api.example.com',
      };

      const json = builder.toJSON(variables);
      const parsed = JSON.parse(json);
      
      expect(parsed.http.routers.api.rule).toBe('Host(`api.example.com`)');
    });
  });

  describe('YAML Export', () => {
    it('should export compiled config to YAML', () => {
      const builder = new TraefikConfigBuilder();
      
      builder.addRouter('api', r => 
        r.rule('Host(`~##domain##~`)')
          .service('api-service')
      );

      const variables: VariableContext = {
        domain: 'api.example.com',
      };

      const yaml = builder.toYAML(variables);
      
      expect(yaml).toContain('http:');
      expect(yaml).toContain('routers:');
      expect(yaml).toContain('api:');
      expect(yaml).toContain('rule: Host(`api.example.com`)');
    });
  });

  describe('Statistics', () => {
    it('should return statistics for empty builder', () => {
      const builder = new TraefikConfigBuilder();
      const stats = builder.getStats();

      expect(stats).toMatchObject({
        routers: 0,
        services: 0,
        middlewares: 0,
        hasTLS: false,
      });
    });

    it('should return accurate statistics', () => {
      const builder = new TraefikConfigBuilder();
      
      builder
        .addRouter('api', r => r.rule('Host(`api.example.com`)').service('api-service'))
        .addRouter('web', r => r.rule('Host(`example.com`)').service('web-service'))
        .addService('api-service', s => s.loadBalancer(lb => lb.server('http://api:3000')))
        .addService('web-service', s => s.loadBalancer(lb => lb.server('http://web:8080')))
        .addMiddleware('cors', m => m.cors({ origins: ['*'] }))
        .configureTLS(tls => tls.certificate('/certs/cert.pem', '/certs/key.pem'));

      const stats = builder.getStats();
      
      expect(stats.routers).toBe(2);
      expect(stats.services).toBe(2);
      expect(stats.middlewares).toBe(1);
      expect(stats.hasTLS).toBe(true);
    });
  });

  describe('Clone', () => {
    it('should create independent copy', () => {
      const builder1 = new TraefikConfigBuilder();
      
      builder1.addRouter('api', r => 
        r.rule('Host(`api.example.com`)')
          .service('api-service')
      );

      const builder2 = builder1.clone();
      
      builder2.addRouter('web', r => 
        r.rule('Host(`example.com`)')
          .service('web-service')
      );

      const config1 = builder1.build();
      const config2 = builder2.build();
      
      expect(Object.keys(config1.http?.routers || {})).toHaveLength(1);
      expect(Object.keys(config2.http?.routers || {})).toHaveLength(2);
    });
  });

  describe('Real-World Complete Configurations', () => {
    it('should build simple web application config', () => {
      const builder = new TraefikConfigBuilder();
      
      builder
        .addRouter('web', r => r
          .rule('Host(`example.com`)')
          .service('web-service')
          .entryPoint('websecure')
          .tls({ certResolver: 'letsencrypt' })
        )
        .addService('web-service', s => s
          .loadBalancer(lb => lb.server('http://web:8080'))
        );

      const config = builder.build();
      
      expect(config.http?.routers?.web).toBeDefined();
      expect(config.http?.services?.['web-service']).toBeDefined();
    });

    it('should build API gateway with auth and CORS', () => {
      const builder = new TraefikConfigBuilder();
      
      builder
        .addMiddleware('auth', m => m.basicAuth(
          ['admin:$apr1$...'] as any
        ))
        .addMiddleware('cors', m => m.cors({
          origins: ['https://app.example.com'],
          methods: ['GET', 'POST', 'PUT', 'DELETE'],
          headers: ['Content-Type', 'Authorization'],
        }))
        .addMiddleware('rate-limit', m => m.rateLimit({ 
          average: 100,
          burst: 50,
        }))
        .addRouter('api', r => r
          .rule(rb => rb.host('api.example.com').pathPrefix('/v1'))
          .service('api-service')
          .middlewares('cors', 'auth', 'rate-limit')
          .entryPoint('websecure')
          .priority(100)
        )
        .addService('api-service', s => s
          .loadBalancer(lb => lb
            .server('http://api1:3000')
            .server('http://api2:3000')
            .healthCheck({
              path: '/health',
              interval: '10s',
              timeout: '3s',
            })
          )
        );

      const config = builder.build();
      
      expect(config.http?.middlewares).toHaveProperty('auth');
      expect(config.http?.middlewares).toHaveProperty('cors');
      expect(config.http?.middlewares).toHaveProperty('rate-limit');
      expect(config.http?.routers?.api?.middlewares).toHaveLength(3);
      expect(config.http?.services?.['api-service']?.loadBalancer?.servers).toHaveLength(2);
    });

    it('should build blue-green deployment config with variables', () => {
      const builder = new TraefikConfigBuilder();
      
      builder
        .addService('blue', s => s.loadBalancer(lb => 
          lb.server('http://~##blueHost##~:~##bluePort##~')
        ))
        .addService('green', s => s.loadBalancer(lb => 
          lb.server('http://~##greenHost##~:~##greenPort##~')
        ))
        .addRouter('app', r => r
          .rule('Host(`~##domain##~`)')
          .service('~##activeService##~')
          .entryPoint('websecure')
        );

      const variables: VariableContext = {
        blueHost: 'blue.internal',
        bluePort: 8080,
        greenHost: 'green.internal',
        greenPort: 8080,
        domain: 'app.example.com',
        activeService: 'blue',
      };

      const config = builder.compile(variables);
      
      expect(config.http?.services?.blue).toBeDefined();
      expect(config.http?.services?.green).toBeDefined();
      expect(config.http?.routers?.app?.service).toBe('blue');
    });

    it('should build multi-environment config', () => {
      const builder = new TraefikConfigBuilder();
      
      const environments = ['dev', 'staging', 'prod'];
      
      environments.forEach(env => {
        builder
          .addRouter(`${env}-api`, r => r
            .rule(`Host(\`~##${env}Domain##~\`)`)
            .service(`${env}-service`)
            .middleware(`${env}-auth`)
          )
          .addService(`${env}-service`, s => s
            .loadBalancer(lb => lb.server(`http://~##${env}Host##~:~##${env}Port##~`))
          )
          .addMiddleware(`${env}-auth`, m => m
            .basicAuth([`~##${env}User##~`] as any)
          );
      });

      const config = builder.build();
      expect(Object.keys(config.http?.routers || {})).toHaveLength(3);
      expect(Object.keys(config.http?.services || {})).toHaveLength(3);
      expect(Object.keys(config.http?.middlewares || {})).toHaveLength(3);
    });

    it('should build complete microservices platform', () => {
      const builder = new TraefikConfigBuilder();
      
      // Global middlewares
      builder
        .addMiddleware('global-cors', m => m.cors({
          origins: ['https://app.example.com'],
          methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          headers: ['Content-Type', 'Authorization'],
          credentials: true,
        }))
        .addMiddleware('global-rate-limit', m => m.rateLimit({
          average: 1000,
          burst: 200,
        }))
        .addMiddleware('global-compress', m => m.compress());

      // Auth service
      builder
        .addRouter('auth-service', r => r
          .rule(rb => rb.host('api.example.com').pathPrefix('/auth'))
          .service('auth-service')
          .middlewares('global-cors', 'global-compress')
        )
        .addService('auth-service', s => s
          .loadBalancer(lb => lb
            .server('http://auth1:3001')
            .server('http://auth2:3001')
            .healthCheck({ path: '/health' })
          )
        );

      // User service
      builder
        .addMiddleware('auth-required', m => m.forwardAuth(
          'http://auth-service:3001/verify'
        ))
        .addRouter('user-service', r => r
          .rule(rb => rb.host('api.example.com').pathPrefix('/users'))
          .service('user-service')
          .middlewares('global-cors', 'auth-required', 'global-compress')
        )
        .addService('user-service', s => s
          .loadBalancer(lb => lb
            .server('http://user1:3002')
            .server('http://user2:3002')
            .healthCheck({ path: '/health' })
          )
        );

      // TLS configuration
      builder.configureTLS(tls => tls
        .certificate('/certs/api.example.com.pem', '/certs/api.example.com-key.pem')
        .minVersion('VersionTLS12')
        .maxVersion('VersionTLS13')
      );

      const config = builder.build();
      
      expect(Object.keys(config.http?.routers || {})).toHaveLength(2);
      expect(Object.keys(config.http?.services || {})).toHaveLength(2);
      expect(Object.keys(config.http?.middlewares || {})).toHaveLength(4);
      expect(config.tls?.certificates).toHaveLength(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty builder', () => {
      const builder = new TraefikConfigBuilder();
      
      const config = builder.build();
      const stats = builder.getStats();
      
      expect(config).toEqual({});
      expect(stats.routers).toBe(0);
    });

    it('should handle builder with only routers', () => {
      const builder = new TraefikConfigBuilder();
      
      builder.addRouter('api', r => 
        r.rule('Host(`api.example.com`)')
          .service('api-service')
      );

      const config = builder.build();
      
      expect(config.http?.routers).toBeDefined();
      expect(config.http?.services).toBeUndefined();
      expect(config.http?.middlewares).toBeUndefined();
    });

    it('should handle duplicate names by overwriting', () => {
      const builder = new TraefikConfigBuilder();
      
      builder
        .addRouter('api', r => r.rule('Host(`api1.example.com`)').service('api1'))
        .addRouter('api', r => r.rule('Host(`api2.example.com`)').service('api2'));

      const config = builder.build();
      
      expect(config.http?.routers?.api?.rule).toBe('Host(`api2.example.com`)');
    });
  });
});
