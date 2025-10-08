import { describe, it, expect, beforeEach } from 'vitest';
import {
  Variable,
  StringVariable,
  NumberVariable,
  VariableRegistry,
  VariableValidator,
  VariableResolver,
  VariableRegistrationError,
  VariableResolutionError,
} from '../index';

describe('Variable System', () => {
  describe('Variable', () => {
    it('should create string variable', () => {
      const v = Variable.string('host');
      expect(v.name).toBe('host');
      expect(v.isRequired()).toBe(false);
    });

    it('should mark variable as required', () => {
      const v = Variable.string('host').required();
      expect(v.isRequired()).toBe(true);
    });

    it('should set default value', () => {
      const v = Variable.string('host').default('localhost');
      expect(v.getDefaultValue()).toBe('localhost');
      expect(v.isRequired()).toBe(false);
    });

    it('should validate string values', () => {
      const v = Variable.string('host');
      const result = v.safeParse('example.com');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('example.com');
      }
    });

    it('should fail validation for wrong types', () => {
      const v = Variable.string('host');
      const result = v.safeParse(123);
      expect(result.success).toBe(false);
    });

    it('should create number variable', () => {
      const v = Variable.number('port');
      const result = v.safeParse(8080);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(8080);
      }
    });

    it('should create boolean variable', () => {
      const v = Variable.boolean('enabled');
      const result = v.safeParse(true);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(true);
      }
    });

    it('should create array variable', () => {
      const v = Variable.array('items');
      const result = v.safeParse(['a', 'b', 'c']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(['a', 'b', 'c']);
      }
    });

    it('should add custom validation', () => {
      const v = Variable.string('host').validate(
        v => v.length > 3,
        'Must be longer than 3 characters'
      );
      
      expect(v.safeParse('abc').success).toBe(false);
      expect(v.safeParse('abcd').success).toBe(true);
    });

    it('should apply transformations', () => {
      const v = Variable.string('name')
        .transform(v => v.toUpperCase())
        .transform(v => v.trim());
      
      const result = v.safeParse('  hello  ');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('HELLO');
      }
    });
  });

  describe('StringVariable Patterns', () => {
    it('should validate URL', () => {
      const v = StringVariable.url('apiUrl');
      expect(v.safeParse('https://example.com').success).toBe(true);
      expect(v.safeParse('http://example.com').success).toBe(true);
      expect(v.safeParse('example.com').success).toBe(false);
    });

    it('should validate email', () => {
      const v = StringVariable.email('userEmail');
      expect(v.safeParse('user@example.com').success).toBe(true);
      expect(v.safeParse('invalid-email').success).toBe(false);
    });

    it('should validate domain', () => {
      const v = StringVariable.domain('hostname');
      expect(v.safeParse('example.com').success).toBe(true);
      expect(v.safeParse('sub.example.com').success).toBe(true);
      expect(v.safeParse('invalid domain').success).toBe(false);
    });

    it('should validate path', () => {
      const v = StringVariable.path('apiPath');
      expect(v.safeParse('/api/v1').success).toBe(true);
      expect(v.safeParse('api/v1').success).toBe(false);
    });
  });

  describe('NumberVariable Patterns', () => {
    it('should validate port number', () => {
      const v = NumberVariable.port('serverPort');
      expect(v.safeParse(8080).success).toBe(true);
      expect(v.safeParse(0).success).toBe(false);
      expect(v.safeParse(65536).success).toBe(false);
    });

    it('should validate positive number', () => {
      const v = NumberVariable.positive('count');
      expect(v.safeParse(1).success).toBe(true);
      expect(v.safeParse(0).success).toBe(false);
      expect(v.safeParse(-1).success).toBe(false);
    });

    it('should validate percentage', () => {
      const v = NumberVariable.percentage('progress');
      expect(v.safeParse(50).success).toBe(true);
      expect(v.safeParse(0).success).toBe(true);
      expect(v.safeParse(100).success).toBe(true);
      expect(v.safeParse(101).success).toBe(false);
      expect(v.safeParse(-1).success).toBe(false);
    });
  });

  describe('VariableRegistry', () => {
    let registry: VariableRegistry;

    beforeEach(() => {
      registry = new VariableRegistry();
    });

    it('should register variables', () => {
      const v = Variable.string('host');
      registry.register(v);
      expect(registry.has('host')).toBe(true);
    });

    it('should throw on duplicate registration', () => {
      const v = Variable.string('host');
      registry.register(v);
      expect(() => registry.register(v)).toThrow(VariableRegistrationError);
    });

    it('should get registered variable', () => {
      const v = Variable.string('host');
      registry.register(v);
      const retrieved = registry.get('host');
      expect(retrieved).toBe(v);
    });

    it('should unregister variables', () => {
      const v = Variable.string('host');
      registry.register(v);
      registry.unregister('host');
      expect(registry.has('host')).toBe(false);
    });

    it('should get all required variables', () => {
      registry.register(Variable.string('host').required());
      registry.register(Variable.number('port').optional());
      registry.register(Variable.string('path').required());
      
      const required = registry.getRequired();
      expect(required).toHaveLength(2);
      expect(required.map(v => v.name)).toEqual(['host', 'path']);
    });

    it('should create groups', () => {
      registry.register(Variable.string('host'));
      registry.register(Variable.number('port'));
      registry.createGroup('connection', ['host', 'port']);
      
      const group = registry.getGroup('connection');
      expect(group).toHaveLength(2);
    });

    it('should apply defaults', () => {
      registry.register(Variable.string('host').default('localhost'));
      registry.register(Variable.number('port').default(8080));
      
      const context = registry.applyDefaults({});
      expect(context).toEqual({ host: 'localhost', port: 8080 });
    });

    it('should merge registries', () => {
      const other = new VariableRegistry();
      registry.register(Variable.string('host'));
      other.register(Variable.number('port'));
      
      registry.merge(other);
      expect(registry.has('host')).toBe(true);
      expect(registry.has('port')).toBe(true);
    });
  });

  describe('VariableValidator', () => {
    let registry: VariableRegistry;
    let validator: VariableValidator;

    beforeEach(() => {
      registry = new VariableRegistry();
      validator = new VariableValidator(registry);
    });

    it('should validate context successfully', () => {
      registry.register(Variable.string('host').required());
      registry.register(Variable.number('port').default(8080));
      
      const result = validator.validate({ host: 'example.com' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ host: 'example.com', port: 8080 });
    });

    it('should fail on missing required variables', () => {
      registry.register(Variable.string('host').required());
      
      const result = validator.validate({});
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Required variable 'host' is missing");
    });

    it('should warn on extra variables', () => {
      registry.register(Variable.string('host'));
      
      const result = validator.validate(
        { host: 'example.com', extra: 'value' },
        { warnOnExtra: true }
      );
      
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].variable).toBe('extra');
    });

    it('should extract variable references', () => {
      const refs = validator.extractReferences('Host: ~##host##~, Port: ~##port##~');
      expect(refs).toEqual(['host', 'port']);
    });

    it('should validate references in objects', () => {
      registry.register(Variable.string('host'));
      
      const errors = validator.validateReferences({
        url: '~##host##~/api',
        port: '~##port##~', // port not registered
      });
      
      expect(errors).toHaveLength(1);
      expect(errors[0].variable).toBe('port');
    });
  });

  describe('VariableResolver', () => {
    let registry: VariableRegistry;
    let resolver: VariableResolver;

    beforeEach(() => {
      registry = new VariableRegistry();
      resolver = new VariableResolver(registry);
    });

    it('should resolve simple variables', () => {
      registry.register(Variable.string('host'));
      
      const result = resolver.resolve(
        '~##host##~/api',
        { host: 'example.com' }
      );
      
      expect(result.success).toBe(true);
      expect(result.data).toBe('example.com/api');
    });

    it('should resolve nested objects', () => {
      registry.register(Variable.string('host'));
      registry.register(Variable.number('port'));
      
      const config = {
        url: 'https://~##host##~:~##port##~',
        endpoints: {
          api: '~##host##~/api',
          health: '~##host##~/health',
        },
      };
      
      const result = resolver.resolve(config, {
        host: 'example.com',
        port: 8080,
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        url: 'https://example.com:8080',
        endpoints: {
          api: 'example.com/api',
          health: 'example.com/health',
        },
      });
    });

    it('should resolve arrays', () => {
      registry.register(Variable.string('host'));
      
      const result = resolver.resolve(
        ['~##host##~/api', '~##host##~/health'],
        { host: 'example.com' }
      );
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual(['example.com/api', 'example.com/health']);
    });

    it('should fail on missing variables in strict mode', () => {
      registry.register(Variable.string('host'));
      
      const result = resolver.resolve(
        '~##missing##~/api',
        { host: 'example.com' },
        { strict: true }
      );
      
      expect(result.success).toBe(false);
      expect(result.unresolved).toEqual(['missing']);
    });

    it('should keep unresolved variables when requested', () => {
      registry.register(Variable.string('host'));
      
      const result = resolver.resolve(
        '~##host##~/~##missing##~',
        { host: 'example.com' },
        { keepUnresolved: true }
      );
      
      expect(result.success).toBe(false);
      expect(result.data).toBe('example.com/~##missing##~');
    });

    it('should handle recursive resolution', () => {
      registry.register(Variable.string('protocol'));
      registry.register(Variable.string('host'));
      registry.register(Variable.string('url'));
      
      const result = resolver.resolve(
        '~##url##~/api',
        {
          protocol: 'https',
          host: 'example.com',
          url: '~##protocol##~://~##host##~',
        }
      );
      
      expect(result.success).toBe(true);
      expect(result.data).toBe('https://example.com/api');
    });

    it('should extract all references', () => {
      const refs = resolver.extractReferences({
        url: '~##protocol##~://~##host##~:~##port##~',
        paths: ['~##basePath##~/api', '~##basePath##~/health'],
      });
      
      expect(refs).toEqual(['protocol', 'host', 'port', 'basePath']);
    });

    it('should preview resolution', () => {
      const preview = resolver.preview(
        '~##host##~/~##port##~/~##missing##~',
        { host: 'example.com', port: 8080 }
      );
      
      expect(preview.found).toEqual(['host', 'port']);
      expect(preview.missing).toEqual(['missing']);
      expect(preview.total).toBe(3);
    });

    it('should partially resolve', () => {
      registry.register(Variable.string('host'));
      registry.register(Variable.number('port'));
      
      const result = resolver.partialResolve(
        '~##host##~:~##port##~/~##unknown##~',
        { host: 'example.com' }
      );
      
      expect(result.data).toBe('example.com:~##port##~/~##unknown##~');
    });

    it('should detect circular references', () => {
      registry.register(Variable.string('a'));
      registry.register(Variable.string('b'));
      
      expect(() => {
        resolver.resolveOrThrow(
          '~##a##~',
          {
            a: '~##b##~',
            b: '~##a##~',
          },
          { maxDepth: 5 }
        );
      }).toThrow(/Maximum (recursion depth|call stack size)/);
    });
  });

  describe('Integration', () => {
    it('should work end-to-end', () => {
      // Create registry
      const registry = new VariableRegistry();
      
      // Register variables
      registry.registerMany([
        StringVariable.domain('host').required().describe('API hostname'),
        NumberVariable.port('port').default(443).describe('API port'),
        StringVariable.path('basePath').default('/api/v1').describe('Base API path'),
        Variable.boolean('secure').default(true).describe('Use HTTPS'),
      ]);
      
      // Create validator and resolver
      const validator = new VariableValidator(registry);
      const resolver = new VariableResolver(registry);
      
      // Define config template
      const configTemplate = {
        url: '~##secure##~://~##host##~:~##port##~~##basePath##~',
        endpoints: {
          users: '~##basePath##~/users',
          posts: '~##basePath##~/posts',
        },
      };
      
      // Provide context
      const context = {
        host: 'api.example.com',
        secure: true,
      };
      
      // Validate
      const validationResult = validator.validate(context);
      expect(validationResult.success).toBe(true);
      
      // Resolve
      const resolutionResult = resolver.resolve(configTemplate, context);
      expect(resolutionResult.success).toBe(true);
      expect(resolutionResult.data).toEqual({
        url: 'true://api.example.com:443/api/v1',
        endpoints: {
          users: '/api/v1/users',
          posts: '/api/v1/posts',
        },
      });
    });
  });
});
