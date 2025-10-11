import type { Variable, VariableMetadata } from './variable.types';
import { z } from 'zod';

/**
 * Variable registration error
 */
export class VariableRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VariableRegistrationError';
  }
}

/**
 * Variable context for resolution
 */
export interface VariableContext {
  [key: string]: any;
}

/**
 * Registry for managing variables
 */
export class VariableRegistry {
  private variables = new Map<string, Variable<any>>();
  private groups = new Map<string, Set<string>>();

  /**
   * Register a variable
   */
  register<T>(variable: Variable<T>): void {
    if (this.variables.has(variable.name)) {
      throw new VariableRegistrationError(
        `Variable '${variable.name}' is already registered`
      );
    }
    this.variables.set(variable.name, variable);
  }

  /**
   * Register multiple variables
   */
  registerMany(variables: Variable<any>[]): void {
    for (const variable of variables) {
      this.register(variable);
    }
  }

  /**
   * Get a variable by name
   */
  get<T>(name: string): Variable<T> | undefined {
    return this.variables.get(name);
  }

  /**
   * Check if variable exists
   */
  has(name: string): boolean {
    return this.variables.has(name);
  }

  /**
   * Unregister a variable
   */
  unregister(name: string): boolean {
    return this.variables.delete(name);
  }

  /**
   * Clear all variables
   */
  clear(): void {
    this.variables.clear();
    this.groups.clear();
  }

  /**
   * Get all registered variables
   */
  getAll(): Variable<any>[] {
    return Array.from(this.variables.values());
  }

  /**
   * Get all variable names
   */
  getNames(): string[] {
    return Array.from(this.variables.keys());
  }

  /**
   * Get all required variables
   */
  getRequired(): Variable<any>[] {
    return this.getAll().filter(v => v.isRequired());
  }

  /**
   * Get all optional variables
   */
  getOptional(): Variable<any>[] {
    return this.getAll().filter(v => !v.isRequired());
  }

  /**
   * Create a group of variables
   */
  createGroup(groupName: string, variableNames: string[]): void {
    if (this.groups.has(groupName)) {
      throw new VariableRegistrationError(
        `Group '${groupName}' already exists`
      );
    }

    // Validate that all variables exist
    for (const name of variableNames) {
      if (!this.has(name)) {
        throw new VariableRegistrationError(
          `Variable '${name}' is not registered`
        );
      }
    }

    this.groups.set(groupName, new Set(variableNames));
  }

  /**
   * Get variables in a group
   */
  getGroup(groupName: string): Variable<any>[] {
    const group = this.groups.get(groupName);
    if (!group) {
      return [];
    }

    return Array.from(group)
      .map(name => this.get(name))
      .filter((v): v is Variable<any> => v !== undefined);
  }

  /**
   * Get metadata for all variables
   */
  getMetadata(): Map<string, VariableMetadata> {
    const metadata = new Map<string, VariableMetadata>();
    
    for (const [name, variable] of this.variables) {
      metadata.set(name, variable.getMetadata());
    }
    
    return metadata;
  }

  /**
   * Create a Zod schema from all registered variables
   */
  createSchema(): z.ZodObject<any> {
    const shape: Record<string, z.ZodType<any>> = {};
    
    for (const [name, variable] of this.variables) {
      shape[name] = variable.getSchema();
    }
    
    return z.object(shape);
  }

  /**
   * Validate a context against registered variables
   */
  validate(context: VariableContext): ReturnType<z.ZodType['safeParse']> {
    const schema = this.createSchema();
    return schema.safeParse(context);
  }

  /**
   * Parse and validate a context, throwing on error
   */
  parse(context: VariableContext): VariableContext {
    const schema = this.createSchema();
    return schema.parse(context);
  }

  /**
   * Get missing required variables from context
   */
  getMissingRequired(context: VariableContext): string[] {
    const required = this.getRequired();
    const missing: string[] = [];

    for (const variable of required) {
      if (!(variable.name in context)) {
        missing.push(variable.name);
      }
    }

    return missing;
  }

  /**
   * Get context with defaults applied
   */
  applyDefaults(context: VariableContext): VariableContext {
    const result = { ...context };

    for (const [name, variable] of this.variables) {
      if (!(name in result)) {
        const defaultValue = variable.getDefaultValue();
        if (defaultValue !== undefined) {
          result[name] = defaultValue;
        }
      }
    }

    return result;
  }

  /**
   * Clone the registry
   */
  clone(): VariableRegistry {
    const newRegistry = new VariableRegistry();
    
    for (const [name, variable] of this.variables) {
      newRegistry.variables.set(name, variable);
    }
    
    for (const [groupName, variableNames] of this.groups) {
      newRegistry.groups.set(groupName, new Set(variableNames));
    }
    
    return newRegistry;
  }

  /**
   * Merge with another registry
   */
  merge(other: VariableRegistry, overwrite = false): void {
    for (const [name, variable] of other.variables) {
      if (this.has(name) && !overwrite) {
        throw new VariableRegistrationError(
          `Variable '${name}' already exists. Set overwrite=true to replace.`
        );
      }
      this.variables.set(name, variable);
    }

    for (const [groupName, variableNames] of other.groups) {
      if (this.groups.has(groupName) && !overwrite) {
        throw new VariableRegistrationError(
          `Group '${groupName}' already exists. Set overwrite=true to replace.`
        );
      }
      this.groups.set(groupName, new Set(variableNames));
    }
  }

  /**
   * Export registry as JSON
   */
  toJSON(): any {
    const variables: any[] = [];
    const groups: Record<string, string[]> = {};

    for (const [name, variable] of this.variables) {
      variables.push(variable.getMetadata());
    }

    for (const [groupName, variableNames] of this.groups) {
      groups[groupName] = Array.from(variableNames);
    }

    return {
      variables,
      groups,
    };
  }

  /**
   * Get statistics about the registry
   */
  getStats(): {
    total: number;
    required: number;
    optional: number;
    withDefaults: number;
    groups: number;
  } {
    const all = this.getAll();
    const required = this.getRequired();
    const withDefaults = all.filter(v => v.getDefaultValue() !== undefined);

    return {
      total: all.length,
      required: required.length,
      optional: all.length - required.length,
      withDefaults: withDefaults.length,
      groups: this.groups.size,
    };
  }
}
