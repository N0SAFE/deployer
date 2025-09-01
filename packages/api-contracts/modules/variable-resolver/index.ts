import { oc } from '@orpc/contract';

// Import all contract definitions
import { parseTemplateContract } from './parse-template';
import { resolveTemplateContract } from './resolve-template';
import { resolveVariablesRecursivelyContract } from './resolve-variables-recursively';
import { validateTemplateContract } from './validate-template';
import { getSuggestionsContract } from './get-suggestions';
import { extractReferencesContract } from './extract-references';
import { detectCircularDependenciesContract } from './detect-circular-dependencies';

// Combine into main variable resolver contract
export const variableResolverContract = oc.tag("VariableResolver").prefix("/variable-resolver").router({
  parseTemplate: parseTemplateContract,
  resolveTemplate: resolveTemplateContract,
  resolveVariablesRecursively: resolveVariablesRecursivelyContract,
  validateTemplate: validateTemplateContract,
  getSuggestions: getSuggestionsContract,
  extractReferences: extractReferencesContract,
  detectCircularDependencies: detectCircularDependenciesContract,
});

export type VariableResolverContract = typeof variableResolverContract;

// Re-export everything from individual contracts
export * from './parse-template';
export * from './resolve-template';
export * from './resolve-variables-recursively';
export * from './validate-template';
export * from './get-suggestions';
export * from './extract-references';
export * from './detect-circular-dependencies';

// Export all schemas
export * from './schemas';