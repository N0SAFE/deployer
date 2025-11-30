/**
 * Variable System - Zod-based type-safe variable management
 * 
 * This module provides a comprehensive variable system for the Traefik config builder:
 * - Type-safe variable definitions with Zod schemas
 * - Variable registration and management
 * - Runtime validation
 * - Variable resolution with ~##varName##~ syntax
 */

// Core variable types
export {
  Variable,
  type VariableType,
  type VariableMetadata,
  StringVariable,
  NumberVariable,
} from './variable.types';

// Variable registry
export {
  VariableRegistry,
  type VariableContext,
  VariableRegistrationError,
} from './variable-registry';

// Validation
export {
  VariableValidator,
  type ValidationError,
  type ValidationResult,
  type ValidationOptions,
} from './variable-validator';

// Resolution
export {
  VariableResolver,
  VariableResolutionError,
  type ResolutionOptions,
  type ResolutionResult,
} from './variable-resolver';
