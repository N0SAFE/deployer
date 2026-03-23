import type {
  TLSCertificate,
  TLSStore,
  TLSOptionsConfig,
  TLSConfig,
  VariableString,
  VariableArray,
} from '../../interfaces';

/**
 * Builder for creating Traefik TLS configuration
 */
export class TLSBuilder {
  private config: TLSConfig = {};

  /**
   * Ensure options.default exists
   */
  private ensureDefaultOptions(): TLSOptionsConfig {
    this.config.options ??= {};
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    this.config.options.default ??= {};
    return this.config.options.default;
  }

  /**
   * Ensure stores.default exists
   */
  private ensureDefaultStore(): TLSStore {
    this.config.stores ??= {};
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    this.config.stores.default ??= {};
    return this.config.stores.default;
  }

  /**
   * Add a certificate
   */
  certificate(certFile: VariableString, keyFile: VariableString, stores?: VariableArray<string>): this {
    this.config.certificates ??= [];
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
    this.config.options ??= {};
    this.config.options[name] = config as TLSOptionsConfig;
    return this;
  }

  /**
   * Set minimum TLS version
   */
  minVersion(version: 'VersionTLS10' | 'VersionTLS11' | 'VersionTLS12' | 'VersionTLS13'): this {
    this.ensureDefaultOptions().minVersion = version;
    return this;
  }

  /**
   * Set maximum TLS version
   */
  maxVersion(version: 'VersionTLS10' | 'VersionTLS11' | 'VersionTLS12' | 'VersionTLS13'): this {
    this.ensureDefaultOptions().maxVersion = version;
    return this;
  }

  /**
   * Set cipher suites
   */
  cipherSuites(...suites: string[]): this {
    this.ensureDefaultOptions().cipherSuites = suites as VariableArray<string>;
    return this;
  }

  /**
   * Configure client authentication
   */
  clientAuth(caFiles: VariableArray<string>, authType?: 'NoClientCert' | 'RequestClientCert' | 'RequireAnyClientCert' | 'VerifyClientCertIfGiven' | 'RequireAndVerifyClientCert'): this {
    this.ensureDefaultOptions().clientAuth = {
      caFiles,
      clientAuthType: authType,
    };
    return this;
  }

  /**
   * Configure TLS store
   */
  store(name: string, config: Partial<TLSStore>): this {
    this.config.stores ??= {};
    this.config.stores[name] = config as TLSStore;
    return this;
  }

  /**
   * Set default certificate
   */
  defaultCertificate(certFile: VariableString, keyFile: VariableString): this {
    this.ensureDefaultStore().defaultCertificate = { certFile, keyFile };
    return this;
  }

  /**
   * Build the TLS configuration
   */
  build(): TLSConfig {
    return this.config;
  }
}
