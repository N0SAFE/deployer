import { describe, it, expect } from 'vitest';
import { HttpRouterBuilder } from '../http-router-builder';
import { RuleBuilder } from '../rule-builder';

describe('HttpRouterBuilder', () => {
  describe('Basic Configuration', () => {
    it('should build router with rule string', () => {
      const { name, config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .build();

      expect(name).toBe('api');
      expect(config.rule).toBe('Host(`example.com`)');
      expect(config.service).toBe('api-service');
    });

    it('should build router with RuleBuilder', () => {
      const rule = new RuleBuilder().host('example.com').pathPrefix('/api');
      
      const { config } = new HttpRouterBuilder('api')
        .rule(rule)
        .service('api-service')
        .build();

      expect(config.rule).toBe('Host(`example.com`) && PathPrefix(`/api`)');
    });

    it('should build router with rule builder function', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule(rb => rb.host('example.com').pathPrefix('/api'))
        .service('api-service')
        .build();

      expect(config.rule).toBe('Host(`example.com`) && PathPrefix(`/api`)');
    });

    it('should set service name', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .build();

      expect(config.service).toBe('api-service');
    });

    it('should support variables in rule and service', () => {
      const { config } = new HttpRouterBuilder('dynamic')
        .rule('Host(`~##domain##~`)')
        .service('~##serviceName##~')
        .build();

      expect(config.rule).toBe('Host(`~##domain##~`)');
      expect(config.service).toBe('~##serviceName##~');
    });
  });

  describe('Entry Points', () => {
    it('should set single entry point', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .entryPoint('web')
        .build();

      expect(config.entryPoints).toEqual(['web']);
    });

    it('should set multiple entry points using entryPoints', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .entryPoints('web', 'websecure')
        .build();

      expect(config.entryPoints).toEqual(['web', 'websecure']);
    });

    it('should accumulate entry points', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .entryPoint('web')
        .entryPoint('websecure')
        .build();

      expect(config.entryPoints).toEqual(['web', 'websecure']);
    });
  });

  describe('Middlewares', () => {
    it('should set single middleware', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .middleware('cors')
        .build();

      expect(config.middlewares).toEqual(['cors']);
    });

    it('should set multiple middlewares', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .middlewares('auth', 'cors', 'rate-limit')
        .build();

      expect(config.middlewares).toEqual(['auth', 'cors', 'rate-limit']);
    });

    it('should accumulate middlewares', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .middleware('auth')
        .middleware('cors')
        .middleware('rate-limit')
        .build();

      expect(config.middlewares).toEqual(['auth', 'cors', 'rate-limit']);
    });

    it('should support variables in middleware names', () => {
      const { config } = new HttpRouterBuilder('dynamic')
        .rule('Host(`example.com`)')
        .service('api-service')
        .middleware('~##authMiddleware##~')
        .build();

      expect(config.middlewares).toEqual(['~##authMiddleware##~']);
    });
  });

  describe('Priority', () => {
    it('should set router priority', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .priority(100)
        .build();

      expect(config.priority).toBe(100);
    });

    it('should support variable in priority', () => {
      const { config } = new HttpRouterBuilder('dynamic')
        .rule('Host(`example.com`)')
        .service('api-service')
        .priority('~##routerPriority##~' as any)
        .build();

      expect(config.priority).toBe('~##routerPriority##~');
    });
  });

  describe('TLS Configuration', () => {
    it('should enable TLS with boolean', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .tls()
        .build();

      expect(config.tls).toBe(true);
    });

    it('should enable TLS with options', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .tls({ certResolver: 'letsencrypt' })
        .build();

      expect(config.tls).toMatchObject({
        certResolver: 'letsencrypt',
      });
    });

    it('should set cert resolver', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .certResolver('letsencrypt')
        .build();

      expect(typeof config.tls === 'object' && config.tls?.certResolver).toBe('letsencrypt');
    });

    it('should set domain for certificate', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .tls()
        .domain('example.com')
        .build();

      const tlsOptions = typeof config.tls === 'object' ? config.tls : undefined;
      expect(tlsOptions?.domains?.[0].main).toBe('example.com');
    });

    it('should set domain with SANs', () => {
      const { config } = new HttpRouterBuilder('api')
        .rule('Host(`example.com`)')
        .service('api-service')
        .tls()
        .domain('example.com', ['www.example.com', 'api.example.com'])
        .build();

      const tlsOptions = typeof config.tls === 'object' ? config.tls : undefined;
      expect(tlsOptions?.domains?.[0].main).toBe('example.com');
      expect(tlsOptions?.domains?.[0].sans).toEqual(['www.example.com', 'api.example.com']);
    });

    it('should support variables in TLS configuration', () => {
      const { config } = new HttpRouterBuilder('dynamic')
        .rule('Host(`~##domain##~`)')
        .service('api-service')
        .certResolver('~##certResolver##~')
        .domain('~##mainDomain##~')
        .build();

      const tlsOptions = typeof config.tls === 'object' ? config.tls : undefined;
      expect(tlsOptions?.certResolver).toBe('~##certResolver##~');
      expect(tlsOptions?.domains?.[0].main).toBe('~##mainDomain##~');
    });
  });

  describe('Real-World Scenarios', () => {
    it('should build simple HTTP router', () => {
      const { name, config } = new HttpRouterBuilder('blog')
        .rule(rb => rb.host('blog.example.com'))
        .service('blog-service')
        .entryPoint('web')
        .build();

      expect(name).toBe('blog');
      expect(config.rule).toBe('Host(`blog.example.com`)');
      expect(config.service).toBe('blog-service');
      expect(config.entryPoints).toEqual(['web']);
    });

    it('should build HTTPS router with Let\'s Encrypt', () => {
      const { config } = new HttpRouterBuilder('api-secure')
        .rule(rb => rb.host('api.example.com'))
        .service('api-service')
        .entryPoint('websecure')
        .tls({ certResolver: 'letsencrypt' })
        .domain('api.example.com')
        .build();

      expect(config.entryPoints).toEqual(['websecure']);
      const tlsOptions = typeof config.tls === 'object' ? config.tls : undefined;
      expect(tlsOptions?.certResolver).toBe('letsencrypt');
      expect(tlsOptions?.domains?.[0].main).toBe('api.example.com');
    });

    it('should build API gateway router', () => {
      const { config } = new HttpRouterBuilder('api-gateway')
        .rule(rb => rb
          .host('api.example.com')
          .and(r => r.pathPrefix('/v1'))
        )
        .service('api-v1-service')
        .entryPoints('web', 'websecure')
        .middlewares('auth', 'cors', 'rate-limit')
        .priority(100)
        .tls({ certResolver: 'letsencrypt' })
        .build();

      expect(config.middlewares).toHaveLength(3);
      expect(config.priority).toBe(100);
      expect(config.tls).toBeDefined();
    });

    it('should build router with complex routing rules', () => {
      const { config } = new HttpRouterBuilder('admin-api')
        .rule(rb => rb
          .host('admin.example.com')
          .and(r => r.pathPrefix('/api'))
          .and(r => r.method('GET', 'POST'))
        )
        .service('admin-service')
        .middlewares('admin-auth', 'audit-log')
        .priority(200)
        .build();

      expect(config.rule).toContain('Host(`admin.example.com`)');
      expect(config.rule).toContain('PathPrefix(`/api`)');
      expect(config.rule).toContain('Method(`GET`, `POST`)');
      expect(config.priority).toBe(200);
    });

    it('should build multi-domain router with wildcard', () => {
      const { config } = new HttpRouterBuilder('multi-domain')
        .rule(rb => rb
          .host('example.com')
          .or(r => r.host('www.example.com'))
          .or(r => r.host('blog.example.com'))
        )
        .service('frontend-service')
        .entryPoint('websecure')
        .tls({ certResolver: 'letsencrypt' })
        .domain('example.com', ['*.example.com'])
        .build();

      expect(config.rule).toContain('||');
      const tlsOptions = typeof config.tls === 'object' ? config.tls : undefined;
      expect(tlsOptions?.domains?.[0].sans).toContain('*.example.com');
    });
  });

  describe('Edge Cases', () => {
    it('should get router name', () => {
      const builder = new HttpRouterBuilder('test-router');
      expect(builder.getName()).toBe('test-router');
    });

    it('should build minimal router', () => {
      const { name, config } = new HttpRouterBuilder('minimal')
        .rule('Host(`example.com`)')
        .service('service')
        .build();

      expect(name).toBe('minimal');
      expect(config.rule).toBeDefined();
      expect(config.service).toBeDefined();
    });

    it('should build router with all options', () => {
      const { config } = new HttpRouterBuilder('complete')
        .rule(rb => rb.host('example.com').pathPrefix('/api'))
        .service('api-service')
        .entryPoints('web', 'websecure')
        .middlewares('auth', 'cors', 'rate-limit')
        .priority(100)
        .tls({ certResolver: 'letsencrypt' })
        .domain('example.com', ['www.example.com'])
        .build();

      expect(config.rule).toBeDefined();
      expect(config.service).toBeDefined();
      expect(config.entryPoints).toBeDefined();
      expect(config.middlewares).toBeDefined();
      expect(config.priority).toBeDefined();
      expect(config.tls).toBeDefined();
    });

    it('should handle TLS without cert resolver', () => {
      const { config } = new HttpRouterBuilder('tls-no-resolver')
        .rule('Host(`example.com`)')
        .service('service')
        .tls()
        .build();

      expect(config.tls).toBe(true);
    });

    it('should support all variable types', () => {
      const { config } = new HttpRouterBuilder('all-vars')
        .rule('Host(`~##domain##~`)')
        .service('~##service##~')
        .entryPoint('~##entryPoint##~')
        .middleware('~##middleware##~')
        .priority('~##priority##~' as any)
        .certResolver('~##certResolver##~')
        .domain('~##mainDomain##~', ['~##san1##~', '~##san2##~'])
        .build();

      expect(config.rule).toContain('~##domain##~');
      expect(config.service).toBe('~##service##~');
      expect(config.entryPoints).toContain('~##entryPoint##~');
      expect(config.middlewares).toContain('~##middleware##~');
      const tlsOptions = typeof config.tls === 'object' ? config.tls : undefined;
      expect(tlsOptions?.certResolver).toBe('~##certResolver##~');
    });
  });
});
