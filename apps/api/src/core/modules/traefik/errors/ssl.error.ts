import { TraefikError } from './config.error';

/**
 * Error thrown when SSL/TLS certificate operations fail
 */
export class SSLCertificateError extends TraefikError {
  constructor(
    message: string,
    public readonly domain: string,
    public readonly operation?: 'create' | 'read' | 'update' | 'delete' | 'renew'
  ) {
    super(message, 'SSL_CERTIFICATE_ERROR', { domain, operation });
    this.name = SSLCertificateError.name;
  }
}

/**
 * Error thrown when an SSL certificate is not found
 */
export class SSLCertificateNotFoundError extends TraefikError {
  constructor(public readonly domain: string) {
    super(
      `SSL certificate not found for domain: ${domain}`,
      'SSL_CERTIFICATE_NOT_FOUND',
      { domain }
    );
    this.name = SSLCertificateNotFoundError.name;
  }
}

/**
 * Error thrown when an SSL certificate is expired
 */
export class SSLCertificateExpiredError extends TraefikError {
  constructor(
    public readonly domain: string,
    public readonly expiredAt: Date
  ) {
    super(
      `SSL certificate for '${domain}' expired on ${expiredAt.toISOString()}`,
      'SSL_CERTIFICATE_EXPIRED',
      { domain, expiredAt: expiredAt.toISOString() }
    );
    this.name = SSLCertificateExpiredError.name;
  }
}

/**
 * Error thrown when SSL certificate validation fails
 */
export class SSLCertificateValidationError extends TraefikError {
  constructor(
    public readonly domain: string,
    public readonly validationErrors: string[]
  ) {
    super(
      `Invalid SSL certificate for '${domain}': ${validationErrors.join(', ')}`,
      'SSL_CERTIFICATE_VALIDATION_ERROR',
      { domain, validationErrors }
    );
    this.name = SSLCertificateValidationError.name;
  }
}
