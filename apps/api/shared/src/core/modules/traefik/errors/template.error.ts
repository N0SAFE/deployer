import { TraefikError } from './config.error';

/**
 * Base error class for all template-related errors in the Traefik module
 */
export class TemplateError extends TraefikError {
  constructor(
    message: string,
    code: string,
    public readonly template?: string,
    additionalContext?: Record<string, unknown>
  ) {
    // Truncate template for context to avoid huge error objects
    super(message, code, { 
      template: template?.substring(0, 500),
      ...additionalContext
    });
    this.name = TemplateError.name;
  }
}

/**
 * Error thrown when a template has invalid syntax
 */
export class TemplateSyntaxError extends TemplateError {
  constructor(
    message: string,
    public readonly line?: number,
    public readonly column?: number,
    template?: string
  ) {
    const location = line !== undefined 
      ? `Line ${String(line)}${column !== undefined ? `, Column ${String(column)}` : ''}`
      : undefined;
    
    super(message, 'TEMPLATE_SYNTAX_ERROR', template, { line, column, location });
    this.name = TemplateSyntaxError.name;
  }
}

/**
 * Error thrown when a template variable is missing or invalid
 */
export class TemplateVariableError extends TemplateError {
  constructor(
    public readonly variableName: string,
    public readonly reason: 'missing' | 'invalid_type' | 'invalid_value',
    public readonly expectedType?: string
  ) {
    const reasonMessages: Record<typeof reason, string> = {
      missing: 'is not defined',
      invalid_type: `has invalid type (expected: ${expectedType ?? 'unknown'})`,
      invalid_value: 'has an invalid value'
    };
    
    super(
      `Template variable '${variableName}' ${reasonMessages[reason]}`,
      'TEMPLATE_VARIABLE_ERROR',
      undefined,
      { variableName, reason, expectedType }
    );
    this.name = TemplateVariableError.name;
  }
}

/**
 * Error thrown when a template is not found
 */
export class TemplateNotFoundError extends TemplateError {
  constructor(
    public readonly templateName: string
  ) {
    super(`Template not found: ${templateName}`, 'TEMPLATE_NOT_FOUND', undefined, { templateName });
    this.name = TemplateNotFoundError.name;
  }
}

/**
 * Error thrown when template rendering fails
 */
export class TemplateRenderError extends TemplateError {
  constructor(
    message: string,
    template?: string,
    public readonly cause?: Error
  ) {
    super(message, 'TEMPLATE_RENDER_ERROR', template, { 
      causeName: cause?.name,
      causeMessage: cause?.message
    });
    this.name = TemplateRenderError.name;
    if (cause?.stack) {
      this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack}`;
    }
  }
}
