import { DomainError } from './domain-error';

/**
 * Base error class for domain verification failures.
 * 
 * @example
 * ```typescript
 * throw new DomainVerificationError('Verification service unavailable');
 * // Error message: "[DomainVerificationError] Verification service unavailable"
 * ```
 */
export class DomainVerificationError extends DomainError {}

/**
 * Thrown when DNS lookup fails during verification.
 * 
 * @example
 * ```typescript
 * throw new DnsLookupError('_deployer-verify.example.com', 'TXT', 'ENOTFOUND');
 * // Error message: "[DnsLookupError] DNS lookup failed for TXT record '_deployer-verify.example.com': ENOTFOUND"
 * ```
 */
export class DnsLookupError extends DomainVerificationError {
  public readonly recordType: string;
  public readonly recordName: string;
  public readonly dnsError: string;

  constructor(recordName: string, recordType: 'TXT' | 'CNAME', dnsError: string) {
    super(`DNS lookup failed for ${recordType} record '${recordName}': ${dnsError}`);
    this.recordType = recordType;
    this.recordName = recordName;
    this.dnsError = dnsError;
  }
}

/**
 * Thrown when the verification token found in DNS doesn't match the expected token.
 * 
 * @example
 * ```typescript
 * throw new VerificationTokenMismatchError('example.com');
 * // Error message: "[VerificationTokenMismatchError] Verification token mismatch for domain 'example.com'. The DNS record value does not match the expected verification token."
 * ```
 */
export class VerificationTokenMismatchError extends DomainVerificationError {
  constructor(domain: string) {
    super(
      `Verification token mismatch for domain '${domain}'. The DNS record value does not match the expected verification token.`
    );
  }
}

/**
 * Thrown when the verification DNS record is not found.
 * 
 * @example
 * ```typescript
 * throw new VerificationRecordNotFoundError('example.com', 'TXT');
 * // Error message: "[VerificationRecordNotFoundError] Verification TXT record not found for domain 'example.com'. Please add the required DNS record and wait for propagation (up to 48 hours)."
 * ```
 */
export class VerificationRecordNotFoundError extends DomainVerificationError {
  constructor(domain: string, recordType: 'TXT' | 'CNAME') {
    super(
      `Verification ${recordType} record not found for domain '${domain}'. Please add the required DNS record and wait for propagation (up to 48 hours).`
    );
  }
}

/**
 * Thrown when verification attempt fails due to internal error.
 * 
 * @example
 * ```typescript
 * throw new VerificationAttemptError('domain-123', 'Network timeout');
 * // Error message: "[VerificationAttemptError] Verification attempt failed for domain ID 'domain-123': Network timeout"
 * ```
 */
export class VerificationAttemptError extends DomainVerificationError {
  constructor(domainId: string, reason: string) {
    super(`Verification attempt failed for domain ID '${domainId}': ${reason}`);
  }
}
