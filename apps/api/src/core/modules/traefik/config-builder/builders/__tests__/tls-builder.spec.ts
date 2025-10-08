import { describe, it, expect } from 'vitest';
import { TLSBuilder } from '../tls-builder';

describe('TLSBuilder', () => {
  describe('Certificates', () => {
    it('should add a single certificate', () => {
      const config = new TLSBuilder()
        .certificate('/certs/cert.pem', '/certs/key.pem')
        .build();

      expect(config.certificates).toHaveLength(1);
      expect(config.certificates?.[0]).toMatchObject({
        certFile: '/certs/cert.pem',
        keyFile: '/certs/key.pem',
      });
    });

    it('should add certificate with stores', () => {
      const config = new TLSBuilder()
        .certificate('/certs/cert.pem', '/certs/key.pem', ['store1', 'store2'])
        .build();

      expect(config.certificates?.[0]).toMatchObject({
        certFile: '/certs/cert.pem',
        keyFile: '/certs/key.pem',
        stores: ['store1', 'store2'],
      });
    });

    it('should add multiple certificates', () => {
      const config = new TLSBuilder()
        .certificate('/certs/cert1.pem', '/certs/key1.pem')
        .certificate('/certs/cert2.pem', '/certs/key2.pem')
        .build();

      expect(config.certificates).toHaveLength(2);
    });

    it('should add certificates from array', () => {
      const config = new TLSBuilder()
        .certificates([
          { certFile: '/certs/cert1.pem', keyFile: '/certs/key1.pem' },
          { certFile: '/certs/cert2.pem', keyFile: '/certs/key2.pem' },
        ])
        .build();

      expect(config.certificates).toHaveLength(2);
    });

    it('should support variables in certificate paths', () => {
      const config = new TLSBuilder()
        .certificate('~##certPath##~', '~##keyPath##~')
        .build();

      expect(config.certificates?.[0].certFile).toBe('~##certPath##~');
      expect(config.certificates?.[0].keyFile).toBe('~##keyPath##~');
    });
  });

  describe('TLS Options', () => {
    it('should add TLS options', () => {
      const config = new TLSBuilder()
        .options('default', {
          minVersion: 'VersionTLS12',
          cipherSuites: ['TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256'],
        })
        .build();

      expect(config.options).toHaveProperty('default');
      expect(config.options?.default).toMatchObject({
        minVersion: 'VersionTLS12',
        cipherSuites: ['TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256'],
      });
    });

    it('should set minimum TLS version', () => {
      const config = new TLSBuilder()
        .minVersion('VersionTLS13')
        .build();

      expect(config.options?.default?.minVersion).toBe('VersionTLS13');
    });

    it('should set maximum TLS version', () => {
      const config = new TLSBuilder()
        .maxVersion('VersionTLS13')
        .build();

      expect(config.options?.default?.maxVersion).toBe('VersionTLS13');
    });

    it('should set both min and max versions', () => {
      const config = new TLSBuilder()
        .minVersion('VersionTLS12')
        .maxVersion('VersionTLS13')
        .build();

      expect(config.options?.default?.minVersion).toBe('VersionTLS12');
      expect(config.options?.default?.maxVersion).toBe('VersionTLS13');
    });
  });

  describe('Cipher Suites', () => {
    it('should set cipher suites', () => {
      const config = new TLSBuilder()
        .cipherSuites(
          'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
          'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384'
        )
        .build();

      expect(config.options?.default?.cipherSuites).toEqual([
        'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
        'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
      ]);
    });

    it('should support single cipher suite', () => {
      const config = new TLSBuilder()
        .cipherSuites('TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256')
        .build();

      expect(config.options?.default?.cipherSuites).toHaveLength(1);
    });
  });

  describe('Client Authentication', () => {
    it('should configure client auth with CA files', () => {
      const config = new TLSBuilder()
        .clientAuth(['/certs/ca.pem'])
        .build();

      expect(config.options?.default?.clientAuth).toMatchObject({
        caFiles: ['/certs/ca.pem'],
      });
    });

    it('should configure client auth with auth type', () => {
      const config = new TLSBuilder()
        .clientAuth(['/certs/ca.pem'], 'RequireAndVerifyClientCert')
        .build();

      expect(config.options?.default?.clientAuth).toMatchObject({
        caFiles: ['/certs/ca.pem'],
        clientAuthType: 'RequireAndVerifyClientCert',
      });
    });

    it('should configure optional client auth', () => {
      const config = new TLSBuilder()
        .clientAuth(['/certs/ca.pem'], 'VerifyClientCertIfGiven')
        .build();

      expect(config.options?.default?.clientAuth?.clientAuthType).toBe('VerifyClientCertIfGiven');
    });

    it('should support variables in CA files', () => {
      const config = new TLSBuilder()
        .clientAuth(['~##caPath##~'])
        .build();

      expect(config.options?.default?.clientAuth?.caFiles).toEqual(['~##caPath##~']);
    });
  });

  describe('Stores', () => {
    it('should add TLS store', () => {
      const config = new TLSBuilder()
        .store('default', {
          defaultCertificate: {
            certFile: '/certs/default.pem',
            keyFile: '/certs/default-key.pem',
          },
        })
        .build();

      expect(config.stores).toHaveProperty('default');
      expect(config.stores?.default?.defaultCertificate).toMatchObject({
        certFile: '/certs/default.pem',
        keyFile: '/certs/default-key.pem',
      });
    });

    it('should add multiple stores', () => {
      const config = new TLSBuilder()
        .store('store1', {})
        .store('store2', {})
        .build();

      expect(config.stores).toHaveProperty('store1');
      expect(config.stores).toHaveProperty('store2');
    });
  });

  describe('Default Certificate', () => {
    it('should set default certificate', () => {
      const config = new TLSBuilder()
        .defaultCertificate('/certs/default.pem', '/certs/default-key.pem')
        .build();

      expect(config.stores?.default?.defaultCertificate).toMatchObject({
        certFile: '/certs/default.pem',
        keyFile: '/certs/default-key.pem',
      });
    });

    it('should support variables in default certificate', () => {
      const config = new TLSBuilder()
        .defaultCertificate('~##defaultCert##~', '~##defaultKey##~')
        .build();

      expect(config.stores?.default?.defaultCertificate?.certFile).toBe('~##defaultCert##~');
      expect(config.stores?.default?.defaultCertificate?.keyFile).toBe('~##defaultKey##~');
    });
  });

  describe('Real-World Scenarios', () => {
    it('should build production TLS config', () => {
      const config = new TLSBuilder()
        .certificate('/certs/prod.pem', '/certs/prod-key.pem')
        .minVersion('VersionTLS12')
        .maxVersion('VersionTLS13')
        .cipherSuites(
          'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
          'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
          'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256'
        )
        .build();

      expect(config.certificates).toHaveLength(1);
      expect(config.options?.default?.minVersion).toBe('VersionTLS12');
      expect(config.options?.default?.maxVersion).toBe('VersionTLS13');
      expect(config.options?.default?.cipherSuites).toHaveLength(3);
    });

    it('should build mTLS config', () => {
      const config = new TLSBuilder()
        .certificate('/certs/server.pem', '/certs/server-key.pem')
        .clientAuth(['/certs/client-ca.pem'], 'RequireAndVerifyClientCert')
        .minVersion('VersionTLS12')
        .build();

      expect(config.certificates).toHaveLength(1);
      expect(config.options?.default?.clientAuth?.clientAuthType).toBe('RequireAndVerifyClientCert');
    });

    it('should build multi-domain TLS config', () => {
      const config = new TLSBuilder()
        .certificate('/certs/example.com.pem', '/certs/example.com-key.pem')
        .certificate('/certs/api.example.com.pem', '/certs/api.example.com-key.pem')
        .certificate('/certs/admin.example.com.pem', '/certs/admin.example.com-key.pem')
        .defaultCertificate('/certs/default.pem', '/certs/default-key.pem')
        .build();

      expect(config.certificates).toHaveLength(3);
      expect(config.stores?.default?.defaultCertificate).toBeDefined();
    });

    it('should build secure TLS config with strict settings', () => {
      const config = new TLSBuilder()
        .certificate('/certs/secure.pem', '/certs/secure-key.pem')
        .minVersion('VersionTLS13')
        .cipherSuites(
          'TLS_AES_128_GCM_SHA256',
          'TLS_AES_256_GCM_SHA384',
          'TLS_CHACHA20_POLY1305_SHA256'
        )
        .build();

      expect(config.options?.default?.minVersion).toBe('VersionTLS13');
      expect(config.options?.default?.cipherSuites).toHaveLength(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty TLS builder', () => {
      const config = new TLSBuilder().build();

      expect(config).toBeDefined();
    });

    it('should handle certificate without options', () => {
      const config = new TLSBuilder()
        .certificate('/certs/cert.pem', '/certs/key.pem')
        .build();

      expect(config.certificates).toHaveLength(1);
      expect(config.options).toBeUndefined();
    });

    it('should handle options without certificates', () => {
      const config = new TLSBuilder()
        .minVersion('VersionTLS12')
        .build();

      expect(config.options?.default?.minVersion).toBe('VersionTLS12');
      expect(config.certificates).toBeUndefined();
    });

    it('should chain all methods', () => {
      const config = new TLSBuilder()
        .certificate('/certs/cert.pem', '/certs/key.pem')
        .minVersion('VersionTLS12')
        .maxVersion('VersionTLS13')
        .cipherSuites('TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256')
        .clientAuth(['/certs/ca.pem'])
        .defaultCertificate('/certs/default.pem', '/certs/default-key.pem')
        .build();

      expect(config.certificates).toBeDefined();
      expect(config.options?.default).toBeDefined();
      expect(config.stores?.default?.defaultCertificate).toBeDefined();
    });

    it('should support all variable types', () => {
      const config = new TLSBuilder()
        .certificate('~##cert##~', '~##key##~')
        .defaultCertificate('~##defaultCert##~', '~##defaultKey##~')
        .clientAuth(['~##caFile##~'])
        .build();

      expect(config.certificates?.[0].certFile).toBe('~##cert##~');
      expect(config.stores?.default?.defaultCertificate?.certFile).toBe('~##defaultCert##~');
      expect(config.options?.default?.clientAuth?.caFiles).toEqual(['~##caFile##~']);
    });
  });
});
