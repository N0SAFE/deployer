import type { VariableRegistry, VariableContext } from './variable-registry';
import type { 
  ValidationError, 
  ValidationResult as BaseValidationResult, 
  ValidationOptions 
} from '../../interfaces';
import type { z } from 'zod';
import { ConfigValidationError } from '../../errors';

/**
 * Validation result specific to variable validation
 * Extends base ValidationResult with variable-specific data
 */
export type ValidationResult = Omit<BaseValidationResult, 'isValid' | 'variables'> & {
  success: boolean;
  data?: VariableContext;
}

// Re-export types for convenience
export type { ValidationError, ValidationOptions } from '../../interfaces';

/**
 * Variable validator with comprehensive validation logic
 */
export class VariableValidator {
  constructor(private registry: VariableRegistry) {}

  /**
   * Validate a context against the registry
   */
  validate(
    context: VariableContext,
    options: ValidationOptions = {}
  ): ValidationResult {
    const {
      strict = false,
      allowExtra = true,
      warnOnExtra = true,
      warnOnUnused = false,
      applyDefaults = true,
    } = options;

    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const data = applyDefaults ? this.registry.applyDefaults(context) : { ...context };

    // Check for missing required variables
    const missingRequired = this.registry.getMissingRequired(data);
    for (const name of missingRequired) {
      errors.push({
        variable: name,
        path: name,
        message: `Required variable '${name}' is missing`,
      });
    }

    // Check for unknown variables
    if (!allowExtra || warnOnExtra) {
      const registeredNames = new Set(this.registry.getNames());
      const extraVars = Object.keys(data).filter(key => !registeredNames.has(key));

      for (const name of extraVars) {
        const error: ValidationError = {
          variable: name,
          path: name,
          message: `Unknown variable '${name}' is not registered`,
          value: data[name],
        };

        if (!allowExtra) {
          errors.push(error);
        } else if (warnOnExtra) {
          warnings.push(error);
        }

        // Remove extra variables in strict mode
        if (strict) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete data[name];
        }
      }
    }

    // Validate each variable with its schema
    for (const [name, value] of Object.entries(data)) {
      const variable = this.registry.get(name);
      
      if (!variable) continue; // Skip unknown variables (handled above)

      const result = variable.safeParse(value);
      
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            variable: name,
            path: [name, ...issue.path].join('.'),
            message: issue.message,
            value,
          });
        }
      } else {
        // Update with parsed/transformed value
        data[name] = result.data;
      }
    }

    // Check for unused registered variables
    if (warnOnUnused) {
      const contextKeys = new Set(Object.keys(data));
      const unusedVars = this.registry
        .getAll()
        .filter(v => !v.isRequired() && !contextKeys.has(v.name))
        .map(v => v.name);

      for (const name of unusedVars) {
        warnings.push({
          variable: name,
          path: name,
          message: `Optional variable '${name}' is registered but not provided`,
        });
      }
    }

    return {
      success: errors.length === 0,
      errors,
      warnings,
      data: errors.length === 0 ? data : undefined,
    };
  }

  /**
   * Validate and throw on error
   */
  validateOrThrow(
    context: VariableContext,
    options?: ValidationOptions
  ): VariableContext {
    const result = this.validate(context, options);

    if (!result.success || !result.data) {
      const validationIssues = result.errors.map(e => ({
        path: e.path,
        message: e.message,
        severity: 'error' as const,
        code: 'VARIABLE_VALIDATION_ERROR'
      }));

      throw new ConfigValidationError(validationIssues);
    }

    return result.data;
  }

  /**
   * Check if a variable reference is valid
   */
  isValidReference(ref: string): boolean {
    // Extract variable name from ~##varName##~ syntax
    const match = /^~##\s*(\w+)\s*##~$/.exec(ref);
    if (!match?.[1]) return false;

    const varName = match[1];
    return this.registry.has(varName);
  }

  /**
   * Extract all variable references from a string
   */
  extractReferences(str: string): string[] {
    const regex = /~##\s*(\w+)\s*##~/g;
    const matches = str.matchAll(regex);
    const refs = new Set<string>();

    for (const match of matches) {
      if (match[1]) {
        refs.add(match[1]);
      }
    }

    return Array.from(refs);
  }

  /**
   * Validate all variable references in an object
   */
  validateReferences(obj: unknown, path = ''): ValidationError[] {
    const errors: ValidationError[] = [];

    if (typeof obj === 'string') {
      const refs = this.extractReferences(obj);
      
      for (const ref of refs) {
        if (!this.registry.has(ref)) {
          errors.push({
            variable: ref,
            path: path || 'root',
            message: `Reference to undefined variable '${ref}'`,
            value: obj,
          });
        }
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        const itemPath = path ? `${path}[${String(index)}]` : `[${String(index)}]`;
        errors.push(...this.validateReferences(item, itemPath));
      });
    } else if (obj && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        const keyPath = path ? `${path}.${key}` : key;
        errors.push(...this.validateReferences(value, keyPath));
      }
    }

    return errors;
  }

  /**
   * Get validation summary
   */
  getSummary(result: ValidationResult): string {
    const lines: string[] = [];

    if (result.success) {
      lines.push('✓ Validation successful');
    } else {
      lines.push('✗ Validation failed');
    }

    if (result.errors.length > 0) {
      lines.push(`\nErrors (${String(result.errors.length)}):`);
      for (const error of result.errors) {
        lines.push(`  - ${error.path}: ${error.message}`);
      }
    }

    if (result.warnings.length > 0) {
      lines.push(`\nWarnings (${String(result.warnings.length)}):`);
      for (const warning of result.warnings) {
        lines.push(`  - ${warning.path}: ${warning.message}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Create a validator with custom Zod schema
   * Returns a generic validation function, not a ValidationResult (which is for VariableContext)
   */
  static fromSchema<T>(schema: z.ZodType<T>): (value: unknown) => {
    success: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
    data?: T;
  } {
    return (value: unknown) => {
      const result = schema.safeParse(value);

      if (result.success) {
        return {
          success: true,
          errors: [],
          warnings: [],
          data: result.data,
        };
      }

      const errors: ValidationError[] = result.error.issues.map(issue => ({
        variable: 'value',
        path: issue.path.join('.') || 'root',
        message: issue.message,
        value,
      }));

      return {
        success: false,
        errors,
        warnings: [],
      };
    };
  }

  /**
   * Combine multiple validation results
   */
  static combineResults(...results: ValidationResult[]): ValidationResult {
    const allErrors = results.flatMap(r => r.errors);
    const allWarnings = results.flatMap(r => r.warnings);

    return {
      success: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
      data: allErrors.length === 0 ? results[results.length - 1]?.data : undefined,
    };
  }
}
