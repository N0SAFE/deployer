/**
 * Domain Verification Interfaces
 *
 * Types for DNS-based domain ownership verification.
 * Supports TXT and CNAME record verification methods.
 *
 * @module domain/interfaces/verification
 */

// ============================================================================
// VERIFICATION METHODS
// ============================================================================

/**
 * Supported verification methods for domain ownership
 */
export type VerificationMethod = 'txt_record' | 'cname_record';

// ============================================================================
// VERIFICATION INSTRUCTIONS
// ============================================================================

/**
 * DNS verification instructions provided to users
 */
export interface VerificationInstructions {
  /** The verification method (TXT or CNAME record) */
  method: VerificationMethod;
  /** The DNS record name to create (e.g., `_deployer-verify.example.com`) */
  recordName: string;
  /** The value to set for the DNS record */
  recordValue: string;
  /** Human-readable instructions for the user */
  instructions: string;
}

// ============================================================================
// VERIFICATION RESULTS
// ============================================================================

/**
 * Result of a domain verification attempt
 */
export interface VerifyDomainResult {
  /** Whether the verification was successful */
  success: boolean;
  /** Current verification status */
  status: 'verified' | 'failed';
  /** Human-readable message about the result */
  message: string;
  /** Timestamp when domain was verified (only present on success) */
  verifiedAt?: Date;
  /** Error details (only present on failure) */
  error?: {
    /** Machine-readable error code */
    code: string;
    /** Human-readable error details */
    details: string;
  };
}
