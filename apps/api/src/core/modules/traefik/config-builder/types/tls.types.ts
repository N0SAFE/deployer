import type { VariableString, VariableBoolean, VariableArray } from './common.types';

/**
 * TLS certificate configuration
 */
export interface TLSCertificate {
  certFile: VariableString;
  keyFile: VariableString;
  stores?: VariableArray<string>;
}

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
    clientAuthType?: 'NoClientCert' | 'RequestClientCert' | 'RequireAnyClientCert' | 'VerifyClientCertIfGiven' | 'RequireAndVerifyClientCert';
  };
  sniStrict?: VariableBoolean;
  alpnProtocols?: VariableArray<string>;
}

/**
 * TLS configuration
 */
export interface TLSConfig {
  certificates?: TLSCertificate[];
  options?: Record<string, TLSOptionsConfig>;
  stores?: Record<string, TLSStore>;
}
