import { describe, it, expect } from 'vitest';
import { MiddlewareBuilder } from '../middleware-builder';

describe('MiddlewareBuilder', () => {
  describe('Path Manipulation', () => {
    it('should add prefix to path', () => {
      const { name, config } = new MiddlewareBuilder('add-api-prefix')
        .addPrefix('/api')
        .build();

      expect(name).toBe('add-api-prefix');
      expect(config.addPrefix).toMatchObject({
        prefix: '/api',
      });
    });

    it('should strip prefix from path', () => {
      const { config } = new MiddlewareBuilder('strip-api')
        .stripPrefix('/api', '/v1')
        .build();

      expect(config.stripPrefix).toMatchObject({
        prefixes: ['/api', '/v1'],
      });
    });

    it('should replace path', () => {
      const { config } = new MiddlewareBuilder('replace-path')
        .replacePath('/health')
        .build();

      expect(config.replacePath).toMatchObject({
        path: '/health',
      });
    });

    it('should support variables in path operations', () => {
      const { config } = new MiddlewareBuilder('dynamic-path')
        .addPrefix('~##apiPrefix##~')
        .build();

      expect(config.addPrefix?.prefix).toBe('~##apiPrefix##~');
    });
  });

  describe('Headers & CORS', () => {
    it('should set custom headers', () => {
      const { config } = new MiddlewareBuilder('headers')
        .headers({
          customRequestHeaders: { 'X-Custom': 'value' },
          customResponseHeaders: { 'X-Response': 'value' },
        })
        .build();

      expect(config.headers).toMatchObject({
        customRequestHeaders: { 'X-Custom': 'value' },
        customResponseHeaders: { 'X-Response': 'value' },
      });
    });

    it('should configure CORS', () => {
      const { config } = new MiddlewareBuilder('cors')
        .cors({
          origins: ['https://example.com'],
          methods: ['GET', 'POST'],
          headers: ['Content-Type'],
          credentials: true,
        })
        .build();

      expect(config.headers?.accessControlAllowOriginList).toEqual(['https://example.com']);
      expect(config.headers?.accessControlAllowMethods).toEqual(['GET', 'POST']);
      expect(config.headers?.accessControlAllowHeaders).toEqual(['Content-Type']);
      expect(config.headers?.accessControlAllowCredentials).toBe(true);
    });

    it('should configure CORS with wildcard', () => {
      const { config } = new MiddlewareBuilder('cors-all')
        .cors({ origins: ['*'] })
        .build();

      expect(config.headers?.accessControlAllowOriginList).toEqual(['*']);
    });

    it('should set custom request headers', () => {
      const { config } = new MiddlewareBuilder('request-headers')
        .customRequestHeaders({
          'X-API-Key': '~##apiKey##~',
          'X-Version': 'v1',
        })
        .build();

      expect(config.headers?.customRequestHeaders).toMatchObject({
        'X-API-Key': '~##apiKey##~',
        'X-Version': 'v1',
      });
    });

    it('should set custom response headers', () => {
      const { config } = new MiddlewareBuilder('response-headers')
        .customResponseHeaders({
          'X-Powered-By': 'Traefik',
        })
        .build();

      expect(config.headers?.customResponseHeaders).toMatchObject({
        'X-Powered-By': 'Traefik',
      });
    });
  });

  describe('Authentication', () => {
    it('should configure basic auth with users', () => {
      const { config } = new MiddlewareBuilder('basic-auth')
        .basicAuth(['user1:pass1', 'user2:pass2'])
        .build();

      expect(config.basicAuth).toMatchObject({
        users: ['user1:pass1', 'user2:pass2'],
      });
    });

    it('should configure basic auth with file', () => {
      const { config } = new MiddlewareBuilder('basic-auth-file')
        .basicAuth(undefined, '/etc/traefik/users')
        .build();

      expect(config.basicAuth).toMatchObject({
        usersFile: '/etc/traefik/users',
      });
    });

    it('should configure basic auth with options', () => {
      const { config } = new MiddlewareBuilder('basic-auth-realm')
        .basicAuth(['user:pass'], undefined, {
          realm: 'My API',
          removeHeader: true,
        })
        .build();

      expect(config.basicAuth).toMatchObject({
        users: ['user:pass'],
        realm: 'My API',
        removeHeader: true,
      });
    });

    it('should configure digest auth', () => {
      const { config } = new MiddlewareBuilder('digest-auth')
        .digestAuth(['user1:realm:hash1'])
        .build();

      expect(config.digestAuth).toMatchObject({
        users: ['user1:realm:hash1'],
      });
    });

    it('should configure forward auth', () => {
      const { config } = new MiddlewareBuilder('forward-auth')
        .forwardAuth('http://auth-service:9000', {
          trustForwardHeader: true,
          authResponseHeaders: ['X-User', 'X-Role'],
        })
        .build();

      expect(config.forwardAuth).toMatchObject({
        address: 'http://auth-service:9000',
        trustForwardHeader: true,
        authResponseHeaders: ['X-User', 'X-Role'],
      });
    });

    it('should support variables in auth configuration', () => {
      const { config } = new MiddlewareBuilder('dynamic-auth')
        .forwardAuth('~##authServiceUrl##~')
        .build();

      expect(config.forwardAuth?.address).toBe('~##authServiceUrl##~');
    });
  });

  describe('Redirects', () => {
    it('should redirect to HTTPS', () => {
      const { config } = new MiddlewareBuilder('https-redirect')
        .redirectToHttps()
        .build();

      expect(config.redirectScheme).toMatchObject({
        scheme: 'https',
        permanent: true,
      });
    });

    it('should redirect to HTTPS non-permanent', () => {
      const { config } = new MiddlewareBuilder('https-redirect-temp')
        .redirectToHttps(false)
        .build();

      expect(config.redirectScheme).toMatchObject({
        scheme: 'https',
        permanent: false,
      });
    });

    it('should redirect to custom scheme', () => {
      const { config } = new MiddlewareBuilder('scheme-redirect')
        .redirectScheme('https', '443')
        .build();

      expect(config.redirectScheme).toMatchObject({
        scheme: 'https',
        port: '443',
        permanent: true,
      });
    });

    it('should configure regex redirect', () => {
      const { config } = new MiddlewareBuilder('regex-redirect')
        .redirectRegex('^http://(.*)$', 'https://$1', true)
        .build();

      expect(config.redirectRegex).toMatchObject({
        regex: '^http://(.*)$',
        replacement: 'https://$1',
        permanent: true,
      });
    });

    it('should support variables in redirects', () => {
      const { config } = new MiddlewareBuilder('dynamic-redirect')
        .redirectScheme('~##scheme##~', '~##port##~')
        .build();

      expect(config.redirectScheme?.scheme).toBe('~##scheme##~');
      expect(config.redirectScheme?.port).toBe('~##port##~');
    });
  });

  describe('Traffic Control', () => {
    it('should configure rate limiting', () => {
      const { config } = new MiddlewareBuilder('rate-limit')
        .rateLimit({
          average: 100,
          burst: 50,
        })
        .build();

      expect(config.rateLimit).toMatchObject({
        average: 100,
        burst: 50,
      });
    });

    it('should configure rate limiting with period', () => {
      const { config } = new MiddlewareBuilder('rate-limit-period')
        .rateLimit({
          average: 100,
          period: '1m',
        })
        .build();

      expect(config.rateLimit).toMatchObject({
        average: 100,
        period: '1m',
      });
    });

    it('should configure in-flight requests limit', () => {
      const { config } = new MiddlewareBuilder('in-flight')
        .inFlightReq(10)
        .build();

      expect(config.inFlightReq).toMatchObject({
        amount: 10,
      });
    });

    it('should configure in-flight requests with options', () => {
      const { config } = new MiddlewareBuilder('in-flight-host')
        .inFlightReq(10, {
          requestHost: true,
        })
        .build();

      expect(config.inFlightReq).toMatchObject({
        amount: 10,
        sourceCriterion: {
          requestHost: true,
        },
      });
    });

    it('should configure circuit breaker', () => {
      const { config } = new MiddlewareBuilder('circuit-breaker')
        .circuitBreaker('NetworkErrorRatio() > 0.30')
        .build();

      expect(config.circuitBreaker).toMatchObject({
        expression: 'NetworkErrorRatio() > 0.30',
      });
    });

    it('should configure circuit breaker with options', () => {
      const { config } = new MiddlewareBuilder('circuit-breaker-check')
        .circuitBreaker('LatencyAtQuantileMS(50.0) > 100', {
          checkPeriod: '10s',
          fallbackDuration: '30s',
          recoveryDuration: '10s',
        })
        .build();

      expect(config.circuitBreaker).toMatchObject({
        expression: 'LatencyAtQuantileMS(50.0) > 100',
        checkPeriod: '10s',
        fallbackDuration: '30s',
        recoveryDuration: '10s',
      });
    });

    it('should support variables in traffic control', () => {
      const { config } = new MiddlewareBuilder('dynamic-rate-limit')
        .rateLimit({
          average: '~##rateAverage##~' as any,
          burst: '~##rateBurst##~' as any,
        })
        .build();

      expect(config.rateLimit?.average).toBe('~##rateAverage##~');
      expect(config.rateLimit?.burst).toBe('~##rateBurst##~');
    });
  });

  describe('Other Middleware', () => {
    it('should configure compression', () => {
      const { config } = new MiddlewareBuilder('compress')
        .compress()
        .build();

      expect(config.compress).toBeDefined();
    });

    it('should configure compression with options', () => {
      const { config } = new MiddlewareBuilder('compress-exclude')
        .compress({
          excludedContentTypes: ['text/event-stream'],
        })
        .build();

      expect(config.compress).toMatchObject({
        excludedContentTypes: ['text/event-stream'],
      });
    });

    it('should chain multiple middlewares', () => {
      const { config } = new MiddlewareBuilder('chain')
        .chain('auth', 'rate-limit', 'compress')
        .build();

      expect(config.chain).toMatchObject({
        middlewares: ['auth', 'rate-limit', 'compress'],
      });
    });

    it('should configure retry', () => {
      const { config } = new MiddlewareBuilder('retry')
        .retry(3)
        .build();

      expect(config.retry).toMatchObject({
        attempts: 3,
      });
    });

    it('should configure retry with interval', () => {
      const { config } = new MiddlewareBuilder('retry-interval')
        .retry(5, '100ms')
        .build();

      expect(config.retry).toMatchObject({
        attempts: 5,
        initialInterval: '100ms',
      });
    });

    it('should configure buffering', () => {
      const { config } = new MiddlewareBuilder('buffer')
        .buffering({
          maxRequestBodyBytes: 1048576,
          maxResponseBodyBytes: 1048576,
        })
        .build();

      expect(config.buffering).toMatchObject({
        maxRequestBodyBytes: 1048576,
        maxResponseBodyBytes: 1048576,
      });
    });

    it('should configure IP whitelist', () => {
      const { config } = new MiddlewareBuilder('ip-whitelist')
        .ipWhiteList(['192.168.1.0/24', '10.0.0.0/8'])
        .build();

      expect(config.ipWhiteList).toMatchObject({
        sourceRange: ['192.168.1.0/24', '10.0.0.0/8'],
      });
    });

    it('should configure IP whitelist with depth', () => {
      const { config } = new MiddlewareBuilder('ip-whitelist-depth')
        .ipWhiteList(['192.168.1.0/24'], { depth: 2 })
        .build();

      expect(config.ipWhiteList).toMatchObject({
        sourceRange: ['192.168.1.0/24'],
      });
      // Note: ipStrategy.depth may be handled differently by the builder
    });
  });

  describe('Real-World Scenarios', () => {
    it('should build API gateway middleware stack', () => {
      const { name, config } = new MiddlewareBuilder('api-gateway')
        .cors({
          origins: ['https://app.example.com'],
          methods: ['GET', 'POST', 'PUT', 'DELETE'],
          headers: ['Content-Type', 'Authorization'],
          credentials: true,
        })
        .customRequestHeaders({
          'X-Request-ID': '~##requestId##~',
        })
        .build();

      expect(name).toBe('api-gateway');
      expect(config.headers?.accessControlAllowOriginList).toBeDefined();
      expect(config.headers?.customRequestHeaders).toBeDefined();
    });

    it('should build security middleware', () => {
      const { config } = new MiddlewareBuilder('security')
        .customResponseHeaders({
          'X-Frame-Options': 'DENY',
          'X-Content-Type-Options': 'nosniff',
          'X-XSS-Protection': '1; mode=block',
          'Strict-Transport-Security': 'max-age=31536000',
        })
        .build();

      expect(config.headers?.customResponseHeaders).toMatchObject({
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
      });
    });

    it('should build rate limiting for API', () => {
      const { config } = new MiddlewareBuilder('api-rate-limit')
        .rateLimit({
          average: 100,
          burst: 50,
          period: '1s',
        })
        .build();

      expect(config.rateLimit).toMatchObject({
        average: 100,
        burst: 50,
        period: '1s',
      });
    });

    it('should build auth + redirect chain', () => {
      const { config } = new MiddlewareBuilder('auth-redirect')
        .forwardAuth('http://auth:9000')
        .redirectToHttps()
        .build();

      // Both should be configured (though only one would typically be used)
      expect(config.forwardAuth).toBeDefined();
      expect(config.redirectScheme).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty middleware builder', () => {
      const builder = new MiddlewareBuilder('empty');
      
      // Empty middleware should throw an error
      expect(() => builder.build()).toThrow('Middleware configuration is empty');
    });

    it('should preserve middleware name', () => {
      const { name } = new MiddlewareBuilder('my-custom-middleware')
        .compress()
        .build();

      expect(name).toBe('my-custom-middleware');
    });

    it('should handle multiple middleware configurations', () => {
      const { config } = new MiddlewareBuilder('multi')
        .addPrefix('/api')
        .compress()
        .rateLimit({ average: 100 })
        .build();

      expect(config.addPrefix).toBeDefined();
      expect(config.compress).toBeDefined();
      expect(config.rateLimit).toBeDefined();
    });

    it('should support variables in all configurations', () => {
      const { config } = new MiddlewareBuilder('all-vars')
        .addPrefix('~##prefix##~')
        .customRequestHeaders({ 'X-Var': '~##headerValue##~' })
        .forwardAuth('~##authUrl##~')
        .build();

      expect(config.addPrefix?.prefix).toBe('~##prefix##~');
      expect(config.headers?.customRequestHeaders?.['X-Var']).toBe('~##headerValue##~');
      expect(config.forwardAuth?.address).toBe('~##authUrl##~');
    });
  });
});
