import { describe, it, expect } from 'vitest';
import { StaticProviderService } from '../static-provider.service';

describe('StaticProviderService - Traefik Config', () => {
  describe('getDefaultTraefikConfig', () => {
    // Test the method directly since it doesn't use any dependencies
    const getDefaultConfig = StaticProviderService.prototype.getDefaultTraefikConfig;

    it('should generate default configuration without options', () => {
      const builder = getDefaultConfig.call({});
      const config = builder.build();

      // Verify router exists
      expect(config.http?.routers?.['static-files']).toBeDefined();
      expect(config.http?.routers?.['static-files']?.rule).toBe('Host(`~##domain##~`)');
      expect(config.http?.routers?.['static-files']?.service).toBe('static-files-service');
      expect(config.http?.routers?.['static-files']?.entryPoints).toContain('web');

      // Verify nginx service (port 80)
      expect(config.http?.services?.['static-files-service']).toBeDefined();
      expect(
        config.http?.services?.['static-files-service']?.loadBalancer?.servers?.[0]?.url
      ).toBe('http://~##containerName##~:80');

      // Verify health check on root path
      expect(
        config.http?.services?.['static-files-service']?.loadBalancer?.healthCheck
      ).toBeDefined();
      expect(
        config.http?.services?.['static-files-service']?.loadBalancer?.healthCheck?.path
      ).toBe('/');
      expect(
        config.http?.services?.['static-files-service']?.loadBalancer?.healthCheck?.interval
      ).toBe('30s');

      // Verify no middlewares by default
      expect(config.http?.middlewares).toBeUndefined();
      expect(config.tls).toBeUndefined();
    });

    it('should generate configuration with custom domain', () => {
      const builder = getDefaultConfig.call({}, {
        domain: 'static.example.com',
      });
      const config = builder.build();

      expect(config.http?.routers?.['static-files']?.rule).toBe('Host(`static.example.com`)');
    });

    it('should generate configuration with SSL enabled', () => {
      const builder = getDefaultConfig.call({}, {
        enableSSL: true,
      });
      const config = builder.build();

      // Verify router uses websecure entrypoint
      expect(config.http?.routers?.['static-files']?.entryPoints).toContain('websecure');

      // Verify TLS configuration
      expect(config.tls?.certificates).toBeDefined();
      expect(config.tls?.certificates?.[0]?.certFile).toBe('~##certFile##~');
      expect(config.tls?.certificates?.[0]?.keyFile).toBe('~##keyFile##~');
      expect(config.tls?.options?.default?.minVersion).toBe('VersionTLS12');
    });

    it('should generate configuration with compression enabled', () => {
      const builder = getDefaultConfig.call({}, {
        enableCompression: true,
      });
      const config = builder.build();

      // Verify compression middleware exists
      expect(config.http?.middlewares?.compress).toBeDefined();
      expect(config.http?.middlewares?.compress?.compress).toBeDefined();
    });

    it('should generate configuration with caching enabled', () => {
      const builder = getDefaultConfig.call({}, {
        enableCaching: true,
      });
      const config = builder.build();

      // Verify cache headers middleware exists
      expect(config.http?.middlewares?.['cache-headers']).toBeDefined();
      expect(
        config.http?.middlewares?.['cache-headers']?.headers?.customResponseHeaders
      ).toBeDefined();
      expect(
        config.http?.middlewares?.['cache-headers']?.headers?.customResponseHeaders?.[
          'Cache-Control'
        ]
      ).toBe('public, max-age=31536000');
      expect(
        config.http?.middlewares?.['cache-headers']?.headers?.customResponseHeaders?.[
          'X-Cache-Status'
        ]
      ).toBe('HIT');
    });

    it('should generate configuration with all options enabled', () => {
      const builder = getDefaultConfig.call({}, {
        domain: 'cdn.example.com',
        enableSSL: true,
        enableCompression: true,
        enableCaching: true,
      });
      const config = builder.build();

      // Verify router
      expect(config.http?.routers?.['static-files']?.rule).toBe('Host(`cdn.example.com`)');
      expect(config.http?.routers?.['static-files']?.entryPoints).toContain('websecure');

      // Verify nginx service
      expect(config.http?.services?.['static-files-service']).toBeDefined();

      // Verify all middlewares
      expect(config.http?.middlewares?.compress).toBeDefined();
      expect(config.http?.middlewares?.['cache-headers']).toBeDefined();

      // Verify TLS
      expect(config.tls?.certificates).toBeDefined();
      expect(config.tls?.options?.default?.minVersion).toBe('VersionTLS12');
    });

    it('should generate config optimized for static file serving', () => {
      const builder = getDefaultConfig.call({}, {
        enableCompression: true,
        enableCaching: true,
      });
      const config = builder.build();

      // Static files should have longer health check intervals
      expect(
        config.http?.services?.['static-files-service']?.loadBalancer?.healthCheck?.interval
      ).toBe('30s');

      // Should use port 80 for nginx
      expect(
        config.http?.services?.['static-files-service']?.loadBalancer?.servers?.[0]?.url
      ).toContain(':80');

      // Should have caching configured
      expect(config.http?.middlewares?.['cache-headers']).toBeDefined();
    });

    it('should generate config with variables that can be compiled', () => {
      const builder = getDefaultConfig.call({}, {
        domain: '~##projectName##~.~##environment##~.example.com',
        enableCaching: true,
      });

      const context = {
        projectName: 'docs',
        environment: 'production',
        containerName: 'static-nginx-1',
        certFile: '/certs/wildcard-cert.pem',
        keyFile: '/certs/wildcard-key.pem',
      };

      const compiled = builder.compile(context);

      expect(compiled.http?.routers?.['static-files']?.rule).toBe(
        'Host(`docs.production.example.com`)'
      );
      expect(
        compiled.http?.services?.['static-files-service']?.loadBalancer?.servers?.[0]?.url
      ).toBe('http://static-nginx-1:80');
    });

    it('should export config to YAML', () => {
      const builder = getDefaultConfig.call({}, {
        domain: 'cdn.example.com',
        enableCaching: true,
        enableCompression: true,
      });

      const yaml = builder.toYAML(
        {
          domain: 'cdn.example.com',
          containerName: 'nginx',
        },
        { strict: false }
      );

      expect(yaml).toContain('static-files');
      expect(yaml).toContain('cdn.example.com');
      expect(yaml).toContain('compress');
      expect(yaml).toContain('cache-headers');
    });

    it('should use fixed port 80 for nginx containers', () => {
      const builder = getDefaultConfig.call({});
      const config = builder.build();

      // Static provider always uses port 80 (nginx standard)
      expect(
        config.http?.services?.['static-files-service']?.loadBalancer?.servers?.[0]?.url
      ).toBe('http://~##containerName##~:80');
    });

    it('should use root path for health checks', () => {
      const builder = getDefaultConfig.call({});
      const config = builder.build();

      // Static files should check root path
      expect(
        config.http?.services?.['static-files-service']?.loadBalancer?.healthCheck?.path
      ).toBe('/');

      // With longer interval than dynamic apps
      expect(
        config.http?.services?.['static-files-service']?.loadBalancer?.healthCheck?.interval
      ).toBe('30s');
    });

    it('should support caching headers for CDN optimization', () => {
      const builder = getDefaultConfig.call({}, {
        enableCaching: true,
      });
      const config = builder.build();

      const cacheHeaders =
        config.http?.middlewares?.['cache-headers']?.headers?.customResponseHeaders;
      expect(cacheHeaders).toBeDefined();
      expect(cacheHeaders?.['Cache-Control']).toContain('max-age=31536000');
      expect(cacheHeaders?.['X-Cache-Status']).toBe('HIT');
    });

    it('should support compression for bandwidth optimization', () => {
      const builder = getDefaultConfig.call({}, {
        enableCompression: true,
      });
      const config = builder.build();

      expect(config.http?.middlewares?.compress?.compress).toBeDefined();
    });
  });
});
