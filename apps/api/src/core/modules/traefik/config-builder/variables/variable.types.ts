import { z } from 'zod';

/**
 * Variable types supported by the system
 */
export type VariableType = 'string' | 'number' | 'boolean' | 'array' | 'object';

/**
 * Variable metadata for documentation and validation
 */
export interface VariableMetadata {
  name: string;
  type: VariableType;
  description?: string;
  required: boolean;
  defaultValue?: any;
  schema: z.ZodType<any>;
}

/**
 * Variable definition with Zod schema
 */
export class Variable<T = any> {
  private _schema: z.ZodType<T>;
  private _required = false;
  private _defaultValue?: T;
  private _description?: string;
  private _transformers: Array<(value: T) => T> = [];

  constructor(
    public readonly name: string,
    schema: z.ZodType<T>
  ) {
    this._schema = schema;
  }

  /**
   * Create a string variable
   */
  static string(name: string): Variable<string> {
    return new Variable(name, z.string());
  }

  /**
   * Create a number variable
   */
  static number(name: string): Variable<number> {
    return new Variable(name, z.number());
  }

  /**
   * Create a boolean variable
   */
  static boolean(name: string): Variable<boolean> {
    return new Variable(name, z.boolean());
  }

  /**
   * Create an array variable
   */
  static array<T>(name: string, itemSchema?: z.ZodType<T>): Variable<T[]> {
    const schema = itemSchema ? z.array(itemSchema) : z.array(z.any());
    return new Variable(name, schema);
  }

  /**
   * Create an object variable
   */
  static object<T extends z.ZodRawShape>(name: string, shape: T): Variable<z.infer<z.ZodObject<T>>> {
    return new Variable(name, z.object(shape));
  }

  /**
   * Create a custom variable with Zod schema
   */
  static custom<T>(name: string, schema: z.ZodType<T>): Variable<T> {
    return new Variable(name, schema);
  }

  /**
   * Mark variable as required
   */
  required(): this {
    this._required = true;
    return this;
  }

  /**
   * Mark variable as optional
   */
  optional(): this {
    this._required = false;
    this._schema = this._schema.optional() as z.ZodType<T>;
    return this;
  }

  /**
   * Set default value
   */
  default(value: T): this {
    this._defaultValue = value;
    this._schema = this._schema.default(value) as z.ZodType<T>;
    this._required = false;
    return this;
  }

  /**
   * Add description for documentation
   */
  describe(description: string): this {
    this._description = description;
    this._schema = this._schema.describe(description);
    return this;
  }

  /**
   * Add custom validation
   */
  validate(validator: (value: T) => boolean, message?: string): this {
    this._schema = this._schema.refine(validator, { message }) as z.ZodType<T>;
    return this;
  }

  /**
   * Add transformation function
   */
  transform(transformer: (value: T) => T): this {
    this._transformers.push(transformer);
    return this;
  }

  /**
   * Get the Zod schema
   */
  getSchema(): z.ZodType<T> {
    return this._schema;
  }

  /**
   * Get variable metadata
   */
  getMetadata(): VariableMetadata {
    return {
      name: this.name,
      type: this.getType(),
      description: this._description,
      required: this._required,
      defaultValue: this._defaultValue,
      schema: this._schema,
    };
  }

  /**
   * Get variable type
   */
  private getType(): VariableType {
    if (this._schema instanceof z.ZodString) return 'string';
    if (this._schema instanceof z.ZodNumber) return 'number';
    if (this._schema instanceof z.ZodBoolean) return 'boolean';
    if (this._schema instanceof z.ZodArray) return 'array';
    if (this._schema instanceof z.ZodObject) return 'object';
    return 'string'; // Default fallback
  }

  /**
   * Parse and validate a value
   */
  parse(value: unknown): T {
    let result = this._schema.parse(value);
    
    // Apply transformers
    for (const transformer of this._transformers) {
      result = transformer(result);
    }
    
    return result;
  }

  /**
   * Safe parse without throwing
   */
  safeParse(value: unknown): ReturnType<z.ZodType<T>['safeParse']> {
    const result = this._schema.safeParse(value);
    
    if (result.success && this._transformers.length > 0) {
      let transformedValue = result.data;
      for (const transformer of this._transformers) {
        transformedValue = transformer(transformedValue);
      }
      return { success: true, data: transformedValue };
    }
    
    return result;
  }

  /**
   * Check if variable is required
   */
  isRequired(): boolean {
    return this._required;
  }

  /**
   * Get default value
   */
  getDefaultValue(): T | undefined {
    return this._defaultValue;
  }
}

/**
 * Predefined string variable patterns
 */
export class StringVariable {
  /**
   * URL string variable
   */
  static url(name: string): Variable<string> {
    return Variable.string(name)
      .validate(v => /^https?:\/\/.+/.test(v), 'Must be a valid URL')
      .describe('A valid HTTP/HTTPS URL');
  }

  /**
   * Email string variable
   */
  static email(name: string): Variable<string> {
    return Variable.string(name)
      .validate(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Must be a valid email')
      .describe('A valid email address');
  }

  /**
   * Domain string variable
   */
  static domain(name: string): Variable<string> {
    return Variable.string(name)
      .validate(v => /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i.test(v), 'Must be a valid domain')
      .describe('A valid domain name');
  }

  /**
   * Path string variable
   */
  static path(name: string): Variable<string> {
    return Variable.string(name)
      .validate(v => v.startsWith('/'), 'Must start with /')
      .describe('A valid path starting with /');
  }

  /**
   * Regex pattern variable
   */
  static regex(name: string): Variable<string> {
    return Variable.string(name)
      .validate(v => {
        try {
          new RegExp(v);
          return true;
        } catch {
          return false;
        }
      }, 'Must be a valid regex pattern')
      .describe('A valid regular expression');
  }
}

/**
 * Predefined number variable patterns
 */
export class NumberVariable {
  /**
   * Port number variable
   */
  static port(name: string): Variable<number> {
    return Variable.number(name)
      .validate(v => v >= 1 && v <= 65535, 'Must be a valid port (1-65535)')
      .describe('A valid port number');
  }

  /**
   * Positive number variable
   */
  static positive(name: string): Variable<number> {
    return Variable.number(name)
      .validate(v => v > 0, 'Must be positive')
      .describe('A positive number');
  }

  /**
   * Non-negative number variable
   */
  static nonNegative(name: string): Variable<number> {
    return Variable.number(name)
      .validate(v => v >= 0, 'Must be non-negative')
      .describe('A non-negative number');
  }

  /**
   * Percentage variable (0-100)
   */
  static percentage(name: string): Variable<number> {
    return Variable.number(name)
      .validate(v => v >= 0 && v <= 100, 'Must be between 0 and 100')
      .describe('A percentage value (0-100)');
  }
}
