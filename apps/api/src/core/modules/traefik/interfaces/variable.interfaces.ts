/**
 * Traefik Variable System Interfaces
 *
 * Types for the variable definition, registration, and resolution system.
 *
 * @module traefik/interfaces/variable
 */

// ============================================================================
// VARIABLE TYPES
// ============================================================================

/**
 * Variable types supported by the system
 */
export type VariableType = 'string' | 'number' | 'boolean' | 'array' | 'object';

/**
 * Variable metadata for documentation and validation
 */
export interface VariableMetadata {
  /** Variable name */
  name: string;
  /** Variable type */
  type: VariableType;
  /** Description for documentation */
  description?: string;
  /** Whether the variable is required */
  required: boolean;
  /** Default value if not provided */
  defaultValue?: unknown;
  /** Zod schema for validation */
  schema: unknown;
}

// ============================================================================
// VARIABLE CONTEXT
// ============================================================================

/**
 * Variable context for resolution
 * Maps variable names to their values
 */
export type VariableContext = Record<string, unknown>;

// ============================================================================
// RESOLUTION TYPES
// ============================================================================

/**
 * Resolution options for variable resolver
 */
export interface ResolutionOptions {
  /** Fail on undefined variables */
  strict?: boolean;
  /** Keep ~##var##~ if variable not found */
  keepUnresolved?: boolean;
  /** Maximum resolution depth */
  maxDepth?: number;
  /** Variable delimiter (default: '~##' and '##~') */
  delimiter?: string;
  /** Validate context before resolution */
  validate?: boolean;
}

import type { ValidationError } from './validation.interfaces';

/**
 * Resolution result
 */
export interface ResolutionResult<T = unknown> {
  /** Whether resolution was successful */
  success: boolean;
  /** Resolved data */
  data?: T;
  /** Resolution errors */
  errors: ValidationError[];
  /** List of unresolved variable names */
  unresolved: string[];
}

// ============================================================================
// REGISTRY STATS
// ============================================================================

/**
 * Statistics about the variable registry
 */
export interface RegistryStats {
  /** Total number of variables */
  total: number;
  /** Number of required variables */
  required: number;
  /** Number of optional variables */
  optional: number;
  /** Number of variables with defaults */
  withDefaults: number;
  /** Number of groups */
  groups: number;
}
