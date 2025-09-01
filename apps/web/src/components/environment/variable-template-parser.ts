export interface VariableReference {
  type: 'service' | 'project' | 'env';
  name: string;
  property: string;
  fullPath: string;
  raw: string;
}

export interface ParseError {
  type: 'syntax_error' | 'invalid_reference' | 'empty_reference';
  message: string;
  position: number;
  raw: string;
}

export interface ParseResult {
  isValid: boolean;
  references: VariableReference[];
  errors: ParseError[];
}

export interface ResolutionError {
  type: 'resolution_error';
  message: string;
  reference: string;
  raw: string;
}

export interface ResolveResult {
  success: boolean;
  resolved: string;
  errors: ResolutionError[];
}

export interface ValidationWarning {
  type: 'deep_nesting_warning' | 'potential_circular_reference';
  message: string;
  position?: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ParseError[];
  warnings: ValidationWarning[];
}

export interface CircularReferenceResult {
  hasCircularReferences: boolean;
  cycles: string[][];
}

export interface ResolutionContext {
  services: Record<string, unknown>;
  projects: Record<string, unknown>;
  env: Record<string, string>;
}

export class VariableTemplateParser {
  private readonly VARIABLE_REGEX = /\$\{([^}]+)\}/g;
  private readonly REFERENCE_REGEX = /^(services|projects|env)\.([^.]+)(?:\.(.+))?$/;

  parseTemplate(template: string): ParseResult {
    const references: VariableReference[] = [];
    const errors: ParseError[] = [];
    
    if (!template) {
      return { isValid: true, references: [], errors: [] };
    }

    let match;

    while ((match = this.VARIABLE_REGEX.exec(template)) !== null) {
      const [fullMatch, content] = match;
      const position = match.index;

      if (!content.trim()) {
        errors.push({
          type: 'empty_reference',
          message: 'Empty variable reference',
          position,
          raw: fullMatch,
        });
        continue;
      }

      const refMatch = content.match(this.REFERENCE_REGEX);
      if (!refMatch) {
        errors.push({
          type: 'invalid_reference',
          message: `Invalid reference format: ${content}`,
          position,
          raw: fullMatch,
        });
        continue;
      }

      const [, type, name, property = ''] = refMatch;
      references.push({
        type: type as 'service' | 'project' | 'env',
        name,
        property,
        fullPath: content,
        raw: fullMatch,
      });
    }

    // Check for unclosed references
    const openBraces = (template.match(/\$\{/g) || []).length;
    const closeBraces = (template.match(/\}/g) || []).length;
    
    if (openBraces !== closeBraces) {
      errors.push({
        type: 'syntax_error',
        message: 'Unclosed variable reference',
        position: template.lastIndexOf('${'),
        raw: template.substring(template.lastIndexOf('${')),
      });
    }

    return {
      isValid: errors.length === 0,
      references,
      errors,
    };
  }

  async resolveTemplate(template: string, context: ResolutionContext): Promise<ResolveResult> {
    const parseResult = this.parseTemplate(template);
    
    if (!parseResult.isValid) {
      return {
        success: false,
        resolved: template,
        errors: parseResult.errors.map(error => ({
          type: 'resolution_error' as const,
          message: error.message,
          reference: '',
          raw: error.raw,
        })),
      };
    }

    let resolved = template;
    const errors: ResolutionError[] = [];

    for (const reference of parseResult.references) {
      try {
        const value = this.resolveReference(reference, context);
        if (value !== undefined) {
          resolved = resolved.replace(reference.raw, String(value));
        } else {
          errors.push({
            type: 'resolution_error',
            message: `Cannot resolve reference: ${reference.fullPath}`,
            reference: reference.fullPath,
            raw: reference.raw,
          });
        }
      } catch (error) {
        errors.push({
          type: 'resolution_error',
          message: `Error resolving ${reference.fullPath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          reference: reference.fullPath,
          raw: reference.raw,
        });
      }
    }

    return {
      success: errors.length === 0,
      resolved: errors.length === 0 ? resolved : template,
      errors,
    };
  }

  private resolveReference(reference: VariableReference, context: ResolutionContext): unknown {
    const { type, name, property } = reference;
    
    let target: Record<string, unknown> | undefined;
    switch (type) {
      case 'service':
        target = context.services[name] as Record<string, unknown>;
        break;
      case 'project':
        target = context.projects[name] as Record<string, unknown>;
        break;
      case 'env':
        return context.env[name];
      default:
        return undefined;
    }

    if (!target) {
      return undefined;
    }

    if (!property) {
      return target;
    }

    // Navigate nested properties
    const properties = property.split('.');
    let current: unknown = target;
    
    for (const prop of properties) {
      if (current && typeof current === 'object' && current !== null && prop in current) {
        current = (current as Record<string, unknown>)[prop];
      } else {
        return undefined;
      }
    }

    return current;
  }

  validateTemplate(template: string): ValidationResult {
    const parseResult = this.parseTemplate(template);
    const warnings: ValidationWarning[] = [];

    // Check for deeply nested properties
    for (const reference of parseResult.references) {
      const depth = reference.property.split('.').length;
      if (depth > 4) {
        warnings.push({
          type: 'deep_nesting_warning',
          message: `Reference ${reference.fullPath} is deeply nested (${depth} levels). Consider flattening the structure.`,
        });
      }
    }

    return {
      isValid: parseResult.isValid,
      errors: parseResult.errors,
      warnings,
    };
  }

  detectCircularReferences(templates: string[], variableContext: Record<string, string>): CircularReferenceResult {
    const dependencyGraph = new Map<string, Set<string>>();
    const cycles: string[][] = [];

    // Build dependency graph
    for (const [variable, template] of Object.entries(variableContext)) {
      const parseResult = this.parseTemplate(template);
      const dependencies = new Set<string>();
      
      for (const reference of parseResult.references) {
        dependencies.add(reference.fullPath);
      }
      
      dependencyGraph.set(variable, dependencies);
    }

    // Detect cycles using DFS
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const currentPath: string[] = [];

    const dfs = (node: string): boolean => {
      if (recursionStack.has(node)) {
        // Found a cycle
        const cycleStart = currentPath.indexOf(node);
        cycles.push([...currentPath.slice(cycleStart), node]);
        return true;
      }

      if (visited.has(node)) {
        return false;
      }

      visited.add(node);
      recursionStack.add(node);
      currentPath.push(node);

      const dependencies = dependencyGraph.get(node) || new Set();
      for (const dependency of dependencies) {
        if (dfs(dependency)) {
          return true;
        }
      }

      recursionStack.delete(node);
      currentPath.pop();
      return false;
    };

    // Check all variables for cycles
    for (const variable of Object.keys(variableContext)) {
      if (!visited.has(variable)) {
        dfs(variable);
      }
    }

    return {
      hasCircularReferences: cycles.length > 0,
      cycles,
    };
  }

  // Utility method to extract all unique references from multiple templates
  extractAllReferences(templates: string[]): VariableReference[] {
    const allReferences: VariableReference[] = [];
    const seen = new Set<string>();

    for (const template of templates) {
      const parseResult = this.parseTemplate(template);
      for (const reference of parseResult.references) {
        if (!seen.has(reference.fullPath)) {
          seen.add(reference.fullPath);
          allReferences.push(reference);
        }
      }
    }

    return allReferences;
  }

  // Get suggested completions for a partial reference
  getSuggestions(partial: string, context: ResolutionContext): string[] {
    const parts = partial.split('.');

    if (parts.length === 1) {
      // Suggest top-level types
      return ['services.', 'projects.', 'env.'];
    }

    const [type, name] = parts;
    let target: Record<string, unknown> | undefined;

    switch (type) {
      case 'services':
        target = context.services;
        break;
      case 'projects':
        target = context.projects;
        break;
      case 'env':
        target = context.env;
        break;
      default:
        return [];
    }

    if (parts.length === 2) {
      // Suggest names
      return Object.keys(target).map(key => `${type}.${key}.`);
    }

    // Navigate to the appropriate level
    const currentTarget = target[name];
    if (!currentTarget || typeof currentTarget !== 'object') {
      return [];
    }

    let current: unknown = currentTarget;
    for (let i = 2; i < parts.length - 1; i++) {
      if (current && typeof current === 'object' && current !== null && parts[i] in current) {
        current = (current as Record<string, unknown>)[parts[i]];
      } else {
        return [];
      }
    }

    // Suggest properties at current level
    if (current && typeof current === 'object' && current !== null) {
      const prefix = parts.slice(0, -1).join('.');
      return Object.keys(current as Record<string, unknown>).map(key => `${prefix}.${key}`);
    }

    return [];
  }
}