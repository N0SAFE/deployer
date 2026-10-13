/**
 * Traefik Validation Interfaces
 *
 * Types for validation errors, results, and options.
 * These are unified across the validation service and variable validator.
 *
 * @module traefik/interfaces/validation
 */

// ============================================================================
// VALIDATION ERRORS
// ============================================================================

/**
 * Validation error with path context
 */
export interface ValidationError {
  /** Variable or field name */
  variable?: string;
  /** Path to the error (e.g., 'http.routers.myRouter.rule') */
  path: string;
  /** Error message */
  message: string;
  /** Error code for programmatic handling */
  code?: string;
  /** The invalid value (if available) */
  value?: unknown;
}

/**
 * Validation warning (non-blocking issues)
 */
export interface ValidationWarning {
  /** Variable or field name (optional) */
  variable?: string;
  /** Path to the issue */
  path: string;
  /** Warning message */
  message: string;
  /** Warning code */
  code?: string;
}

// ============================================================================
// VARIABLE INFO
// ============================================================================

/**
 * Information about a variable in the configuration
 */
export interface VariableInfo {
  /** Variable name */
  name: string;
  /** Whether the variable was resolved */
  resolved: boolean;
  /** Resolved value (if resolved) */
  value?: unknown;
  /** Error message (if resolution failed) */
  error?: string;
}

// ============================================================================
// VALIDATION RESULT
// ============================================================================

/**
 * Result of validation operation
 */
export interface ValidationResult {
  /** Whether validation passed */
  isValid: boolean;
  /** Alternative name for isValid */
  success?: boolean;
  /** Validation errors */
  errors: ValidationError[];
  /** Validation warnings */
  warnings: ValidationWarning[];
  /** Variable information (for config validation) */
  variables?: VariableInfo[];
  /** Validated data (if successful) */
  data?: Record<string, unknown>;
}

// ============================================================================
// VALIDATION OPTIONS
// ============================================================================

/**
 * Options for validation behavior
 */
export interface ValidationOptions {
  /** Fail on unknown variables */
  strict?: boolean;
  /** Allow extra variables not in registry */
  allowExtra?: boolean;
  /** Warn about extra variables */
  warnOnExtra?: boolean;
  /** Warn about unused registered variables */
  warnOnUnused?: boolean;
  /** Apply default values */
  applyDefaults?: boolean;
  /** Validate variable references */
  validateReferences?: boolean;
}
