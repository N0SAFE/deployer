# Variable System

A comprehensive Zod-based variable management system for the Traefik configuration builder. This system provides type-safe variable definitions, validation, and resolution with `{{varName}}` syntax.

## Features

- ✅ **Type-Safe Variables** - Define variables with TypeScript and Zod schemas
- ✅ **Runtime Validation** - Validate variable values at runtime using Zod
- ✅ **Variable Resolution** - Resolve `{{varName}}` placeholders in configurations
- ✅ **Required/Optional** - Mark variables as required or optional with defaults
- ✅ **Custom Validators** - Add custom validation logic to variables
- ✅ **Transformations** - Transform variable values before use
- ✅ **Predefined Patterns** - Built-in validators for URLs, emails, domains, ports, etc.
- ✅ **Recursive Resolution** - Variables can reference other variables
- ✅ **Circular Detection** - Detects and prevents circular variable references

## Quick Start

```typescript
import {
  Variable,
  StringVariable,
  NumberVariable,
  VariableRegistry,
  VariableValidator,
  VariableResolver,
} from './variables';

// 1. Create a registry
const registry = new VariableRegistry();

// 2. Register variables
registry.registerMany([
  StringVariable.domain('host').required().describe('API hostname'),
  NumberVariable.port('port').default(443).describe('API port'),
  StringVariable.path('basePath').default('/api/v1'),
  Variable.boolean('secure').default(true),
]);

// 3. Define configuration template
const configTemplate = {
  url: '{{secure}}://{{host}}:{{port}}{{basePath}}',
  endpoints: {
    users: '{{basePath}}/users',
    posts: '{{basePath}}/posts',
  },
};

// 4. Provide context values
const context = {
  host: 'api.example.com',
  secure: true,
};

// 5. Validate context
const validator = new VariableValidator(registry);
const validationResult = validator.validate(context);

if (!validationResult.success) {
  console.error('Validation errors:', validationResult.errors);
  process.exit(1);
}

// 6. Resolve variables
const resolver = new VariableResolver(registry);
const result = resolver.resolve(configTemplate, context);

if (result.success) {
  console.log('Resolved config:', result.data);
  // Output:
  // {
  //   url: 'true://api.example.com:443/api/v1',
  //   endpoints: {
  //     users: '/api/v1/users',
  //     posts: '/api/v1/posts',
  //   },
  // }
}
```

## Variable Types

### Basic Variables

```typescript
// String variable
const host = Variable.string('host').required();

// Number variable
const port = Variable.number('port').default(8080);

// Boolean variable
const enabled = Variable.boolean('enabled').optional();

// Array variable
const tags = Variable.array('tags', z.string()).default([]);

// Object variable
const config = Variable.object('config', {
  timeout: z.number(),
  retries: z.number(),
});

// Custom Zod schema
const customVar = Variable.custom('custom', z.union([
  z.string(),
  z.number(),
]));
```

### Predefined Patterns

```typescript
// URL validation
const apiUrl = StringVariable.url('apiUrl').required();
// Validates: https://example.com, http://example.com

// Email validation
const email = StringVariable.email('email');
// Validates: user@example.com

// Domain validation
const domain = StringVariable.domain('host');
// Validates: example.com, sub.example.com

// Path validation
const path = StringVariable.path('apiPath');
// Validates: /api/v1 (must start with /)

// Port number validation
const port = NumberVariable.port('port');
// Validates: 1-65535

// Positive number validation
const count = NumberVariable.positive('count');
// Validates: > 0

// Percentage validation
const progress = NumberVariable.percentage('progress');
// Validates: 0-100
```

## Variable Configuration

### Required and Optional

```typescript
// Required variable (must be provided in context)
const host = Variable.string('host').required();

// Optional variable (can be omitted)
const port = Variable.number('port').optional();

// Variable with default (automatically optional)
const timeout = Variable.number('timeout').default(5000);
```

### Descriptions

```typescript
const host = Variable.string('host')
  .required()
  .describe('The hostname of the API server');
```

### Custom Validation

```typescript
const port = Variable.number('port')
  .validate(v => v >= 1024, 'Port must be >= 1024')
  .validate(v => v <= 49151, 'Port must be <= 49151');
```

### Transformations

```typescript
const name = Variable.string('name')
  .transform(v => v.trim())
  .transform(v => v.toLowerCase());
```

## Variable Registry

### Registration

```typescript
const registry = new VariableRegistry();

// Register single variable
registry.register(Variable.string('host'));

// Register multiple variables
registry.registerMany([
  Variable.string('host'),
  Variable.number('port'),
]);
```

### Querying

```typescript
// Check if variable exists
registry.has('host'); // true

// Get variable
const host = registry.get('host');

// Get all variables
const all = registry.getAll();

// Get required variables only
const required = registry.getRequired();

// Get optional variables only
const optional = registry.getOptional();
```

### Groups

```typescript
// Create a group of related variables
registry.createGroup('connection', ['host', 'port', 'timeout']);

// Get variables in a group
const connectionVars = registry.getGroup('connection');
```

### Defaults

```typescript
// Apply default values to context
const context = registry.applyDefaults({
  host: 'example.com',
});
// Returns: { host: 'example.com', port: 8080, timeout: 5000 }
```

## Validation

### Basic Validation

```typescript
const validator = new VariableValidator(registry);

const result = validator.validate({
  host: 'example.com',
  port: 8080,
});

if (result.success) {
  console.log('Valid context:', result.data);
} else {
  console.error('Validation errors:', result.errors);
}
```

### Validation Options

```typescript
const result = validator.validate(context, {
  strict: true,           // Fail on unknown variables
  allowExtra: false,      // Don't allow extra variables
  warnOnExtra: true,      // Warn about extra variables
  warnOnUnused: true,     // Warn about unused registered variables
  applyDefaults: true,    // Apply default values
});
```

### Reference Validation

```typescript
// Validate variable references in a configuration
const errors = validator.validateReferences({
  url: '{{host}}/api',
  port: '{{unknownVar}}', // Will report as error
});
```

### Throw on Error

```typescript
// Validate and throw on error
try {
  const validContext = validator.validateOrThrow(context);
} catch (error) {
  console.error('Validation failed:', error.message);
}
```

## Variable Resolution

### Basic Resolution

```typescript
const resolver = new VariableResolver(registry);

const result = resolver.resolve(
  'https://{{host}}:{{port}}/api',
  { host: 'example.com', port: 8080 }
);

console.log(result.data); // 'https://example.com:8080/api'
```

### Nested Objects

```typescript
const config = {
  server: {
    url: 'https://{{host}}:{{port}}',
    timeout: '{{timeout}}',
  },
  endpoints: ['{{basePath}}/users', '{{basePath}}/posts'],
};

const result = resolver.resolve(config, {
  host: 'example.com',
  port: 8080,
  timeout: 5000,
  basePath: '/api/v1',
});
```

### Resolution Options

```typescript
const result = resolver.resolve(value, context, {
  strict: true,           // Fail on undefined variables
  keepUnresolved: false,  // Keep {{var}} if not found
  maxDepth: 10,           // Maximum recursion depth
  delimiter: '{{',        // Variable delimiter
  validate: true,         // Validate context first
});
```

### Recursive Resolution

Variables can reference other variables:

```typescript
const result = resolver.resolve(
  '{{fullUrl}}/api',
  {
    protocol: 'https',
    host: 'example.com',
    port: 8080,
    fullUrl: '{{protocol}}://{{host}}:{{port}}',
  }
);
// Result: 'https://example.com:8080/api'
```

### Partial Resolution

Resolve only available variables, keep others unresolved:

```typescript
const result = resolver.partialResolve(
  '{{host}}:{{port}}/{{unknown}}',
  { host: 'example.com' }
);
// Result: 'example.com:{{port}}/{{unknown}}'
```

### Preview Resolution

Preview what will be resolved without actually resolving:

```typescript
const preview = resolver.preview(
  '{{host}}:{{port}}/{{missing}}',
  { host: 'example.com', port: 8080 }
);

console.log(preview);
// {
//   found: ['host', 'port'],
//   missing: ['missing'],
//   total: 3
// }
```

## Error Handling

### Validation Errors

```typescript
const result = validator.validate(context);

if (!result.success) {
  result.errors.forEach(error => {
    console.error(`${error.path}: ${error.message}`);
  });
}
```

### Resolution Errors

```typescript
const result = resolver.resolve(template, context, { strict: true });

if (!result.success) {
  console.error('Resolution errors:', result.errors);
  console.error('Unresolved variables:', result.unresolved);
}
```

### Throwing Errors

```typescript
try {
  const data = resolver.resolveOrThrow(template, context);
} catch (error) {
  if (error instanceof VariableResolutionError) {
    console.error(`Variable '${error.variable}' at ${error.path}: ${error.message}`);
  }
}
```

## Advanced Usage

### Variable Groups for Organization

```typescript
// Group variables by feature
registry.createGroup('server', ['host', 'port', 'protocol']);
registry.createGroup('database', ['dbHost', 'dbPort', 'dbName']);
registry.createGroup('redis', ['redisHost', 'redisPort']);

// Get all server-related variables
const serverVars = registry.getGroup('server');
```

### Registry Merging

```typescript
const baseRegistry = new VariableRegistry();
baseRegistry.register(Variable.string('host'));

const extendedRegistry = new VariableRegistry();
extendedRegistry.register(Variable.number('port'));

// Merge registries
baseRegistry.merge(extendedRegistry);
```

### Custom Validation Patterns

```typescript
const semver = Variable.string('version')
  .validate(
    v => /^\d+\.\d+\.\d+$/.test(v),
    'Must be semantic version (e.g., 1.2.3)'
  )
  .describe('Semantic version number');

const hexColor = Variable.string('color')
  .validate(
    v => /^#[0-9A-F]{6}$/i.test(v),
    'Must be hex color (e.g., #FF5733)'
  )
  .describe('Hex color code');
```

### Chained Transformations

```typescript
const username = Variable.string('username')
  .transform(v => v.trim())           // Remove whitespace
  .transform(v => v.toLowerCase())    // Convert to lowercase
  .transform(v => v.replace(/\s+/g, '_')) // Replace spaces with underscores
  .validate(v => v.length >= 3, 'Username must be at least 3 characters');
```

## Best Practices

1. **Always validate before resolving**:
   ```typescript
   const validationResult = validator.validate(context);
   if (!validationResult.success) {
     throw new Error('Invalid context');
   }
   const resolutionResult = resolver.resolve(template, context);
   ```

2. **Use descriptive variable names**:
   ```typescript
   // Good
   const apiServerHost = Variable.string('apiServerHost');
   
   // Avoid
   const h = Variable.string('h');
   ```

3. **Provide defaults for optional variables**:
   ```typescript
   const timeout = Variable.number('timeout').default(5000);
   ```

4. **Use predefined patterns when available**:
   ```typescript
   // Good
   const email = StringVariable.email('userEmail');
   
   // Less ideal
   const email = Variable.string('userEmail')
     .validate(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
   ```

5. **Group related variables**:
   ```typescript
   registry.createGroup('database', [
     'dbHost',
     'dbPort',
     'dbUser',
     'dbPassword',
   ]);
   ```

## Testing

The variable system comes with comprehensive tests covering:

- ✅ Variable creation and configuration
- ✅ String, number, boolean, and array variables
- ✅ Predefined patterns (URL, email, domain, port, etc.)
- ✅ Registry management (registration, groups, defaults)
- ✅ Validation (context, references, errors)
- ✅ Resolution (simple, nested, arrays, recursive)
- ✅ Error handling (validation errors, resolution errors)
- ✅ Edge cases (circular references, missing variables)

Run tests:
```bash
bun x vitest run apps/api/src/core/modules/traefik/config-builder/variables/__tests__/variable-system.test.ts
```

## API Reference

### Variable Class

```typescript
class Variable<T> {
  static string(name: string): Variable<string>
  static number(name: string): Variable<number>
  static boolean(name: string): Variable<boolean>
  static array<T>(name: string, itemSchema?: z.ZodType<T>): Variable<T[]>
  static object<T>(name: string, shape: T): Variable<z.infer<z.ZodObject<T>>>
  static custom<T>(name: string, schema: z.ZodType<T>): Variable<T>
  
  required(): this
  optional(): this
  default(value: T): this
  describe(description: string): this
  validate(validator: (value: T) => boolean, message?: string): this
  transform(transformer: (value: T) => T): this
  
  getSchema(): z.ZodType<T>
  getMetadata(): VariableMetadata
  parse(value: unknown): T
  safeParse(value: unknown): z.SafeParseReturnType<unknown, T>
  isRequired(): boolean
  getDefaultValue(): T | undefined
}
```

### VariableRegistry Class

```typescript
class VariableRegistry {
  register<T>(variable: Variable<T>): void
  registerMany(variables: Variable<any>[]): void
  get<T>(name: string): Variable<T> | undefined
  has(name: string): boolean
  unregister(name: string): boolean
  clear(): void
  getAll(): Variable<any>[]
  getNames(): string[]
  getRequired(): Variable<any>[]
  getOptional(): Variable<any>[]
  createGroup(groupName: string, variableNames: string[]): void
  getGroup(groupName: string): Variable<any>[]
  getMetadata(): Map<string, VariableMetadata>
  createSchema(): z.ZodObject<any>
  validate(context: VariableContext): z.SafeParseReturnType<any, any>
  parse(context: VariableContext): VariableContext
  getMissingRequired(context: VariableContext): string[]
  applyDefaults(context: VariableContext): VariableContext
  clone(): VariableRegistry
  merge(other: VariableRegistry, overwrite?: boolean): void
  toJSON(): any
  getStats(): RegistryStats
}
```

### VariableValidator Class

```typescript
class VariableValidator {
  constructor(registry: VariableRegistry)
  
  validate(context: VariableContext, options?: ValidationOptions): ValidationResult
  validateOrThrow(context: VariableContext, options?: ValidationOptions): VariableContext
  isValidReference(ref: string): boolean
  extractReferences(str: string): string[]
  validateReferences(obj: any, path?: string): ValidationError[]
  getSummary(result: ValidationResult): string
  
  static fromSchema<T>(schema: z.ZodType<T>): (value: unknown) => ValidationResult
  static combineResults(...results: ValidationResult[]): ValidationResult
}
```

### VariableResolver Class

```typescript
class VariableResolver {
  constructor(registry: VariableRegistry)
  
  resolve<T>(value: any, context: VariableContext, options?: ResolutionOptions): ResolutionResult<T>
  resolveOrThrow<T>(value: any, context: VariableContext, options?: ResolutionOptions): T
  extractReferences(value: any, delimiter?: string): string[]
  hasVariablesInValue(value: any, delimiter?: string): boolean
  preview(value: any, context: VariableContext, delimiter?: string): ResolutionPreview
  partialResolve<T>(value: any, context: VariableContext, options?: Omit<ResolutionOptions, 'strict'>): ResolutionResult<T>
}
```
