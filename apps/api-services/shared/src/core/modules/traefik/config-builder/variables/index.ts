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
} from '@/core/modules/traefik/config-builder/variables/variable.types';

// Variable registry
export {
  VariableRegistry,
  type VariableContext,
  VariableRegistrationError,
} from '@/core/modules/traefik/config-builder/variables/variable-registry';

// Validation
export {
  VariableValidator,
  type ValidationError,
  type ValidationResult,
  type ValidationOptions,
} from '@/core/modules/traefik/config-builder/variables/variable-validator';

// Resolution
export {
  VariableResolver,
  VariableResolutionError,
  type ResolutionOptions,
  type ResolutionResult,
} from '@/core/modules/traefik/config-builder/variables/variable-resolver';
