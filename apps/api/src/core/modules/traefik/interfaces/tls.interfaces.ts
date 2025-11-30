/**
 * Traefik TLS Configuration Interfaces
 *
 * TLS/SSL certificate and configuration types.
 *
 * @module traefik/interfaces/tls
 */

import type { VariableString, VariableBoolean, VariableArray } from './common.interfaces';

// ============================================================================
// CERTIFICATE TYPES
// ============================================================================

/**
 * TLS certificate configuration
 */
export interface TLSCertificate {
  certFile: VariableString;
  keyFile: VariableString;
  stores?: VariableArray<string>;
}

// ============================================================================
// TLS STORE
// ============================================================================

/**
 * TLS store configuration
 */
export interface TLSStore {
  defaultCertificate?: {
    certFile: VariableString;
    keyFile: VariableString;
  };
  defaultGeneratedCert?: {
    resolver?: VariableString;
    domain?: {
      main: VariableString;
      sans?: VariableArray<string>;
    };
  };
}

// ============================================================================
// TLS OPTIONS
// ============================================================================

/**
 * Client authentication types
 */
export type ClientAuthType =
  | 'NoClientCert'
  | 'RequestClientCert'
  | 'RequireAnyClientCert'
  | 'VerifyClientCertIfGiven'
  | 'RequireAndVerifyClientCert';

/**
 * TLS options configuration
 */
export interface TLSOptionsConfig {
  minVersion?: VariableString;
  maxVersion?: VariableString;
  cipherSuites?: VariableArray<string>;
  curvePreferences?: VariableArray<string>;
  clientAuth?: {
    caFiles?: VariableArray<string>;
    clientAuthType?: ClientAuthType;
  };
  sniStrict?: VariableBoolean;
  alpnProtocols?: VariableArray<string>;
}

// ============================================================================
// MAIN TLS CONFIG
// ============================================================================

/**
 * Full TLS configuration
 */
export interface TLSConfig {
  certificates?: TLSCertificate[];
  options?: Record<string, TLSOptionsConfig>;
  stores?: Record<string, TLSStore>;
}
