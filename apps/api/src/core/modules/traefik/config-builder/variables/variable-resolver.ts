import type { VariableRegistry, VariableContext } from './variable-registry';
import { VariableValidator, type ValidationError } from './variable-validator';
import type { ResolutionOptions, ResolutionResult } from '../../interfaces';
import { ConfigValidationError } from '../../errors';

/**
 * Resolution error
 */
export class VariableResolutionError extends Error {
  constructor(
    message: string,
    public readonly variable: string,
    public readonly path: string
  ) {
    super(message);
    this.name = 'VariableResolutionError';
  }
}

// Re-export types for convenience
export type { ResolutionOptions, ResolutionResult } from '../../interfaces';

/**
 * Variable resolver for ~##variable##~ substitution
 */
export class VariableResolver {
  private validator: VariableValidator;
  private maxRecursionDepth = 10;

  constructor(private registry: VariableRegistry) {
    this.validator = new VariableValidator(registry);
  }

  /**
   * Resolve variables in a value
   */
  resolve<T>(
    value: T,
    context: VariableContext,
    options: ResolutionOptions = {}
  ): ResolutionResult<T> {
    const {
      strict = false,
      keepUnresolved = false,
      maxDepth = this.maxRecursionDepth,
      delimiter = '~##',
      validate = true,
    } = options;

    const errors: ValidationError[] = [];
    const unresolved = new Set<string>();

    // Validate context if requested
    if (validate) {
      const validationResult = this.validator.validate(context, { applyDefaults: true });
      
      if (!validationResult.success) {
        return {
          success: false,
          errors: validationResult.errors,
          unresolved: [],
        };
      }
      
      // Use validated context with defaults
      context = validationResult.data ?? context;
    }

    try {
      const data = this.resolveValue(
        value,
        context,
        0,
        maxDepth,
        strict,
        keepUnresolved,
        delimiter,
        unresolved,
        ''
      );

      return {
        success: errors.length === 0 && unresolved.size === 0,
        data: data as T,
        errors,
        unresolved: Array.from(unresolved),
      };
    } catch (error) {
      if (error instanceof VariableResolutionError) {
        errors.push({
          variable: error.variable,
          path: error.path,
          message: error.message,
        });
      } else {
        errors.push({
          variable: 'unknown',
          path: 'root',
          message: error instanceof Error ? error.message : String(error),
        });
      }

      return {
        success: false,
        errors,
        unresolved: Array.from(unresolved),
      };
    }
  }

  /**
   * Resolve a single value (recursive)
   */
  private resolveValue(
    value: unknown,
    context: VariableContext,
    depth: number,
    maxDepth: number,
    strict: boolean,
    keepUnresolved: boolean,
    delimiter: string,
    unresolved: Set<string>,
    path: string
  ): unknown {
    // Check recursion depth
    if (depth > maxDepth) {
      throw new VariableResolutionError(
        `Maximum recursion depth (${String(maxDepth)}) exceeded`,
        'unknown',
        path
      );
    }

    // Handle different types
    if (typeof value === 'string') {
      return this.resolveString(
        value,
        context,
        depth,
        maxDepth,
        strict,
        keepUnresolved,
        delimiter,
        unresolved,
        path
      );
    } else if (Array.isArray(value)) {
      return value.map((item, index) =>
        this.resolveValue(
          item,
          context,
          depth + 1,
          maxDepth,
          strict,
          keepUnresolved,
          delimiter,
          unresolved,
          `${path}[${String(index)}]`
        )
      );
    } else if (value && typeof value === 'object') {
      const resolved: Record<string, unknown> = {};
      
      for (const [key, val] of Object.entries(value)) {
        const keyPath = path ? `${path}.${key}` : key;
        resolved[key] = this.resolveValue(
          val,
          context,
          depth + 1,
          maxDepth,
          strict,
          keepUnresolved,
          delimiter,
          unresolved,
          keyPath
        );
      }
      
      return resolved;
    }

    return value;
  }

  /**
   * Resolve variables in a string
   */
  private resolveString(
    str: string,
    context: VariableContext,
    depth: number,
    maxDepth: number,
    strict: boolean,
    keepUnresolved: boolean,
    delimiter: string,
    unresolved: Set<string>,
    path: string
  ): string {
    const closeDelimiter = delimiter === '~##' ? '##~' : delimiter.split('').reverse().join('');
    const regex = new RegExp(
      `${this.escapeRegex(delimiter)}\\s*(\\w+)\\s*${this.escapeRegex(closeDelimiter)}`,
      'g'
    );

    return str.replace(regex, (match: string, varName: string) => {
      // Check if variable exists in context
      if (!(varName in context)) {
        unresolved.add(varName);

        if (strict) {
          throw new VariableResolutionError(
            `Variable '${varName}' is not defined in context`,
            varName,
            path
          );
        }

        return keepUnresolved ? match : '';
      }

      const value = context[varName];

      // If value is a string, recursively resolve it
      if (typeof value === 'string' && this.hasVariables(value, delimiter)) {
        return this.resolveString(
          value,
          context,
          depth + 1,
          maxDepth,
          strict,
          keepUnresolved,
          delimiter,
          unresolved,
          `${path}.${varName}`
        );
      }

      // Convert value to string
      return String(value);
    });
  }

  /**
   * Check if a string contains variables
   */
  private hasVariables(str: string, delimiter: string): boolean {
    const closeDelimiter = delimiter === '~##' ? '##~' : delimiter.split('').reverse().join('');
    const regex = new RegExp(
      `${this.escapeRegex(delimiter)}\\s*\\w+\\s*${this.escapeRegex(closeDelimiter)}`
    );
    return regex.test(str);
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Resolve and throw on error
   */
  resolveOrThrow<T>(
    value: T,
    context: VariableContext,
    options?: ResolutionOptions
  ): T {
    const result = this.resolve(value, context, options);

    if (!result.success) {
      // Convert errors to ValidationIssue format for ConfigValidationError
      const validationIssues = result.errors.map(e => ({
        path: e.path,
        message: e.message,
        severity: 'error' as const,
        code: 'VARIABLE_RESOLUTION_ERROR'
      }));

      // Add unresolved variables as additional issues
      for (const unresolvedVar of result.unresolved) {
        validationIssues.push({
          path: unresolvedVar,
          message: `Variable '${unresolvedVar}' is not defined`,
          severity: 'error' as const,
          code: 'UNRESOLVED_VARIABLE'
        });
      }

      throw new ConfigValidationError(validationIssues);
    }

    // We know data exists when success is true
    return result.data as T;
  }

  /**
   * Extract all variable references from a value
   */
  extractReferences(value: unknown, delimiter = '~##'): string[] {
    const refs = new Set<string>();
    this.extractReferencesRecursive(value, refs, delimiter);
    return Array.from(refs);
  }

  /**
   * Extract references recursively
   */
  private extractReferencesRecursive(
    value: unknown,
    refs: Set<string>,
    delimiter: string
  ): void {
    if (typeof value === 'string') {
      const closeDelimiter = delimiter === '~##' ? '##~' : delimiter.split('').reverse().join('');
      const regex = new RegExp(
        `${this.escapeRegex(delimiter)}\\s*(\\w+)\\s*${this.escapeRegex(closeDelimiter)}`,
        'g'
      );
      
      const matches = value.matchAll(regex);
      for (const match of matches) {
        if (match[1]) {
          refs.add(match[1]);
        }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        this.extractReferencesRecursive(item, refs, delimiter);
      }
    } else if (value && typeof value === 'object') {
      for (const val of Object.values(value)) {
        this.extractReferencesRecursive(val, refs, delimiter);
      }
    }
  }

  /**
   * Check if a value contains any variables
   */
  hasVariablesInValue(value: unknown, delimiter = '~##'): boolean {
    return this.extractReferences(value, delimiter).length > 0;
  }

  /**
   * Preview resolution without actually resolving
   */
  preview(
    value: unknown,
    context: VariableContext,
    delimiter = '~##'
  ): {
    found: string[];
    missing: string[];
    total: number;
  } {
    const refs = this.extractReferences(value, delimiter);
    const found = refs.filter(ref => ref in context);
    const missing = refs.filter(ref => !(ref in context));

    return {
      found,
      missing,
      total: refs.length,
    };
  }

  /**
   * Partially resolve (resolve only available variables)
   */
  partialResolve<T>(
    value: T,
    context: VariableContext,
    options?: Omit<ResolutionOptions, 'strict'>
  ): ResolutionResult<T> {
    return this.resolve(value, context, {
      ...options,
      strict: false,
      keepUnresolved: true,
    });
  }
}
