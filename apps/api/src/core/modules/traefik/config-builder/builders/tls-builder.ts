import type { TLSCertificate, TLSStore, TLSOptionsConfig, TLSConfig } from '../types/tls.types';
import type { VariableString, VariableNumber, VariableArray } from '../types/common.types';

/**
 * Builder for creating Traefik TLS configuration
 */
export class TLSBuilder {
  private config: TLSConfig = {};

  /**
   * Add a certificate
   */
  certificate(certFile: VariableString, keyFile: VariableString, stores?: VariableArray<string>): this {
    if (!this.config.certificates) {
      this.config.certificates = [];
    }
    this.config.certificates.push({ certFile, keyFile, stores });
    return this;
  }

  /**
   * Add multiple certificates
   */
  certificates(certs: TLSCertificate[]): this {
    this.config.certificates = certs;
    return this;
  }

  /**
   * Configure TLS options
   */
  options(name: string, config: Partial<TLSOptionsConfig>): this {
    if (!this.config.options) {
      this.config.options = {};
    }
    this.config.options[name] = config as TLSOptionsConfig;
    return this;
  }

  /**
   * Set minimum TLS version
   */
  minVersion(version: 'VersionTLS10' | 'VersionTLS11' | 'VersionTLS12' | 'VersionTLS13'): this {
    if (!this.config.options) {
      this.config.options = {};
    }
    if (!this.config.options.default) {
      this.config.options.default = {};
    }
    this.config.options.default.minVersion = version;
    return this;
  }

  /**
   * Set maximum TLS version
   */
  maxVersion(version: 'VersionTLS10' | 'VersionTLS11' | 'VersionTLS12' | 'VersionTLS13'): this {
    if (!this.config.options) {
      this.config.options = {};
    }
    if (!this.config.options.default) {
      this.config.options.default = {};
    }
    this.config.options.default.maxVersion = version;
    return this;
  }

  /**
   * Set cipher suites
   */
  cipherSuites(...suites: string[]): this {
    if (!this.config.options) {
      this.config.options = {};
    }
    if (!this.config.options.default) {
      this.config.options.default = {};
    }
    this.config.options.default.cipherSuites = suites as VariableArray<string>;
    return this;
  }

  /**
   * Configure client authentication
   */
  clientAuth(caFiles: VariableArray<string>, authType?: 'NoClientCert' | 'RequestClientCert' | 'RequireAnyClientCert' | 'VerifyClientCertIfGiven' | 'RequireAndVerifyClientCert'): this {
    if (!this.config.options) {
      this.config.options = {};
    }
    if (!this.config.options.default) {
      this.config.options.default = {};
    }
    this.config.options.default.clientAuth = {
      caFiles,
      clientAuthType: authType,
    };
    return this;
  }

  /**
   * Configure TLS store
   */
  store(name: string, config: Partial<TLSStore>): this {
    if (!this.config.stores) {
      this.config.stores = {};
    }
    this.config.stores[name] = config as TLSStore;
    return this;
  }

  /**
   * Set default certificate
   */
  defaultCertificate(certFile: VariableString, keyFile: VariableString): this {
    if (!this.config.stores) {
      this.config.stores = {};
    }
    if (!this.config.stores.default) {
      this.config.stores.default = {};
    }
    this.config.stores.default.defaultCertificate = { certFile, keyFile };
    return this;
  }

  /**
   * Build the TLS configuration
   */
  build(): TLSConfig {
    return this.config;
  }
}
