import { describe, it, expect } from 'vitest';
import { GithubProviderService } from '../github-provider.service';

describe('GithubProviderService - Traefik Config', () => {
  describe('getDefaultTraefikConfig', () => {
    // Test the method directly since it doesn't use any dependencies
    const getDefaultConfig = GithubProviderService.prototype.getDefaultTraefikConfig;

    it('should generate default configuration without options', () => {
      const builder = getDefaultConfig.call({});
      const config = builder.build();

      // Verify router exists
      expect(config.http?.routers?.['github-app']).toBeDefined();
      expect(config.http?.routers?.['github-app']?.rule).toBe('Host(`~##domain##~`)');
      expect(config.http?.routers?.['github-app']?.service).toBe('github-app-service');
      expect(config.http?.routers?.['github-app']?.entryPoints).toContain('web');

      // Verify service exists
      expect(config.http?.services?.['github-app-service']).toBeDefined();
      expect(
        config.http?.services?.['github-app-service']?.loadBalancer?.servers?.[0]?.url
      ).toBe('http://~##containerName##~:~##containerPort##~');

      // Verify health check
      expect(
        config.http?.services?.['github-app-service']?.loadBalancer?.healthCheck
      ).toBeDefined();
      expect(
        config.http?.services?.['github-app-service']?.loadBalancer?.healthCheck?.path
      ).toBe('/health');
      expect(
        config.http?.services?.['github-app-service']?.loadBalancer?.healthCheck?.interval
      ).toBe('10s');

      // Verify no middlewares by default
      expect(config.http?.middlewares).toBeUndefined();
      expect(config.tls).toBeUndefined();
    });

    it('should generate configuration with custom domain', () => {
      const builder = getDefaultConfig.call({}, {
        domain: 'custom.example.com',
      });
      const config = builder.build();

      expect(config.http?.routers?.['github-app']?.rule).toBe('Host(`custom.example.com`)');
    });

    it('should generate configuration with SSL enabled', () => {
      const builder = getDefaultConfig.call({}, {
        enableSSL: true,
      });
      const config = builder.build();

      // Verify router uses websecure entrypoint
      expect(config.http?.routers?.['github-app']?.entryPoints).toContain('websecure');

      // Verify TLS configuration
      expect(config.tls?.certificates).toBeDefined();
      expect(config.tls?.certificates?.[0]?.certFile).toBe('~##certFile##~');
      expect(config.tls?.certificates?.[0]?.keyFile).toBe('~##keyFile##~');
      expect(config.tls?.options?.default?.minVersion).toBe('VersionTLS12');
    });

    it('should generate configuration with CORS enabled', () => {
      const builder = getDefaultConfig.call({}, {
        enableCORS: true,
      });
      const config = builder.build();

      // Verify CORS middleware exists
      expect(config.http?.middlewares?.cors).toBeDefined();
      expect(config.http?.middlewares?.cors?.headers?.accessControlAllowOriginList).toContain('*');
      expect(config.http?.middlewares?.cors?.headers?.accessControlAllowMethods).toContain('GET');
      expect(config.http?.middlewares?.cors?.headers?.accessControlAllowMethods).toContain('POST');
      expect(config.http?.middlewares?.cors?.headers?.accessControlAllowHeaders).toContain(
        'Content-Type'
      );
    });

    it('should generate configuration with rate limiting enabled', () => {
      const builder = getDefaultConfig.call({}, {
        enableRateLimit: true,
      });
      const config = builder.build();

      // Verify rate limit middleware exists
      expect(config.http?.middlewares?.['rate-limit']).toBeDefined();
      expect(config.http?.middlewares?.['rate-limit']?.rateLimit?.average).toBe(100);
      expect(config.http?.middlewares?.['rate-limit']?.rateLimit?.burst).toBe(50);
    });

    it('should generate configuration with all options enabled', () => {
      const builder = getDefaultConfig.call({}, {
        domain: 'app.example.com',
        enableSSL: true,
        enableCORS: true,
        enableRateLimit: true,
      });
      const config = builder.build();

      // Verify router
      expect(config.http?.routers?.['github-app']?.rule).toBe('Host(`app.example.com`)');
      expect(config.http?.routers?.['github-app']?.entryPoints).toContain('websecure');

      // Verify service with health check
      expect(config.http?.services?.['github-app-service']).toBeDefined();

      // Verify all middlewares
      expect(config.http?.middlewares?.cors).toBeDefined();
      expect(config.http?.middlewares?.['rate-limit']).toBeDefined();

      // Verify TLS
      expect(config.tls?.certificates).toBeDefined();
      expect(config.tls?.options?.default?.minVersion).toBe('VersionTLS12');
    });

    it('should generate config with variables that can be compiled', () => {
      const builder = getDefaultConfig.call({}, {
        domain: '~##subdomain##~.~##baseDomain##~',
      });

      const context = {
        subdomain: 'api',
        baseDomain: 'production.com',
        containerName: 'github-app-1',
        containerPort: 3000,
        certFile: '/certs/prod-cert.pem',
        keyFile: '/certs/prod-key.pem',
      };

      const compiled = builder.compile(context);

      expect(compiled.http?.routers?.['github-app']?.rule).toBe('Host(`api.production.com`)');
      expect(compiled.http?.services?.['github-app-service']?.loadBalancer?.servers?.[0]?.url).toBe(
        'http://github-app-1:3000'
      );
    });

    it('should export config to YAML', () => {
      const builder = getDefaultConfig.call({}, {
        domain: 'github.example.com',
        enableSSL: true,
      });

      const yaml = builder.toYAML(
        {
          domain: 'github.example.com',
          containerName: 'app',
          containerPort: 3000,
          certFile: '/certs/cert.pem',
          keyFile: '/certs/key.pem',
        },
        { strict: false }
      );

      expect(yaml).toContain('github-app');
      expect(yaml).toContain('github.example.com');
    });

    it('should use appropriate health check interval for GitHub apps', () => {
      const builder = getDefaultConfig.call({});
      const config = builder.build();

      // GitHub apps should have 10s health check interval (more frequent)
      expect(
        config.http?.services?.['github-app-service']?.loadBalancer?.healthCheck?.interval
      ).toBe('10s');
      expect(
        config.http?.services?.['github-app-service']?.loadBalancer?.healthCheck?.path
      ).toBe('/health');
    });

    it('should support dynamic port configuration', () => {
      const builder = getDefaultConfig.call({});
      const config = builder.build();

      // Verify it uses variable for port
      expect(
        config.http?.services?.['github-app-service']?.loadBalancer?.servers?.[0]?.url
      ).toContain('~##containerPort##~');

      // Compile with custom port
      const compiled = builder.compile(
        {
          domain: 'app.com',
          containerName: 'web',
          containerPort: 8080,
        },
        { strict: false }
      );

      expect(compiled.http?.services?.['github-app-service']?.loadBalancer?.servers?.[0]?.url).toBe(
        'http://web:8080'
      );
    });
  });
});
