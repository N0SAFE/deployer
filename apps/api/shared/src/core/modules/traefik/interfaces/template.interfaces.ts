/**
 * Traefik Template Service Interfaces
 *
 * Types for template parsing and variable replacement.
 *
 * @module traefik/interfaces/template
 */

// ============================================================================
// TEMPLATE VARIABLES
// ============================================================================

/**
 * Template variable definition
 */
export interface TemplateVariable {
  /** Variable name */
  name: string;
  /** Variable description */
  description: string;
  /** Whether variable is required */
  required: boolean;
  /** Default value */
  defaultValue?: string;
  /** Example value */
  example?: string;
}

/**
 * Collection of template variables
 */
export type TemplateVariables = Record<string, TemplateVariable>;

// ============================================================================
// PARSED TEMPLATE
// ============================================================================

/**
 * Parsed template result
 */
export interface ParsedTemplate {
  /** Original template content */
  original: string;
  /** Parsed content with variables replaced */
  content: string;
  /** Variables found in template */
  variables: string[];
  /** Variables that were resolved */
  resolved: string[];
  /** Variables that couldn't be resolved */
  unresolved: string[];
  /** Whether parsing succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// TEMPLATE OPTIONS
// ============================================================================

/**
 * Options for template processing
 */
export interface TemplateOptions {
  /** Variable delimiter start (default: '~##') */
  delimiterStart?: string;
  /** Variable delimiter end (default: '##~') */
  delimiterEnd?: string;
  /** Fail on unresolved variables */
  strict?: boolean;
  /** Keep unresolved variables as-is */
  keepUnresolved?: boolean;
  /** Apply escaping to values */
  escapeValues?: boolean;
}

// ============================================================================
// TEMPLATE CATALOG
// ============================================================================

/**
 * Built-in template types
 */
export type BuiltInTemplateType = 
  | 'service-basic'
  | 'service-ssl'
  | 'service-loadbalancer'
  | 'middleware-ratelimit'
  | 'middleware-auth'
  | 'middleware-cors'
  | 'ssl-letsencrypt'
  | 'ssl-custom';

/**
 * Template catalog entry
 */
export interface TemplateCatalogEntry {
  /** Template type */
  type: BuiltInTemplateType;
  /** Template name */
  name: string;
  /** Template description */
  description: string;
  /** Template content */
  content: string;
  /** Required variables */
  requiredVariables: string[];
  /** Optional variables with defaults */
  optionalVariables: Record<string, unknown>;
}
