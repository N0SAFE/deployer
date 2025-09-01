import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VariableTemplateParser } from './variable-template-parser';

describe('VariableTemplateParser', () => {
  let parser: VariableTemplateParser;

  beforeEach(() => {
    parser = new VariableTemplateParser();
  });

  describe('parseTemplate', () => {
    it('should parse simple variable references', () => {
      const template = '${services.api.url}';
      const result = parser.parseTemplate(template);

      expect(result).toEqual({
        isValid: true,
        references: [
          {
            type: 'service',
            name: 'api',
            property: 'url',
            fullPath: 'services.api.url',
            raw: '${services.api.url}',
          },
        ],
        errors: [],
      });
    });

    it('should parse project references', () => {
      const template = '${projects.myproject.name}';
      const result = parser.parseTemplate(template);

      expect(result).toEqual({
        isValid: true,
        references: [
          {
            type: 'project',
            name: 'myproject',
            property: 'name',
            fullPath: 'projects.myproject.name',
            raw: '${projects.myproject.name}',
          },
        ],
        errors: [],
      });
    });

    it('should parse multiple references in one template', () => {
      const template = 'Database: ${services.db.url}, API: ${services.api.url}';
      const result = parser.parseTemplate(template);

      expect(result).toEqual({
        isValid: true,
        references: [
          {
            type: 'service',
            name: 'db',
            property: 'url',
            fullPath: 'services.db.url',
            raw: '${services.db.url}',
          },
          {
            type: 'service',
            name: 'api',
            property: 'url',
            fullPath: 'services.api.url',
            raw: '${services.api.url}',
          },
        ],
        errors: [],
      });
    });

    it('should handle nested property access', () => {
      const template = '${services.api.config.database.host}';
      const result = parser.parseTemplate(template);

      expect(result).toEqual({
        isValid: true,
        references: [
          {
            type: 'service',
            name: 'api',
            property: 'config.database.host',
            fullPath: 'services.api.config.database.host',
            raw: '${services.api.config.database.host}',
          },
        ],
        errors: [],
      });
    });

    it('should detect invalid references', () => {
      const template = '${invalid.reference}';
      const result = parser.parseTemplate(template);

      expect(result).toEqual({
        isValid: false,
        references: [],
        errors: [
          {
            type: 'invalid_reference',
            message: 'Invalid reference format: invalid.reference',
            position: 2,
            raw: '${invalid.reference}',
          },
        ],
      });
    });

    it('should detect malformed variable syntax', () => {
      const template = '${unclosed.variable';
      const result = parser.parseTemplate(template);

      expect(result).toEqual({
        isValid: false,
        references: [],
        errors: [
          {
            type: 'syntax_error',
            message: 'Unclosed variable reference',
            position: 0,
            raw: '${unclosed.variable',
          },
        ],
      });
    });

    it('should handle empty references', () => {
      const template = '${}';
      const result = parser.parseTemplate(template);

      expect(result).toEqual({
        isValid: false,
        references: [],
        errors: [
          {
            type: 'empty_reference',
            message: 'Empty variable reference',
            position: 0,
            raw: '${}',
          },
        ],
      });
    });

    it('should handle templates without variables', () => {
      const template = 'Just a plain string';
      const result = parser.parseTemplate(template);

      expect(result).toEqual({
        isValid: true,
        references: [],
        errors: [],
      });
    });

    it('should handle complex mixed templates', () => {
      const template = 'Connect to ${services.database.url} from ${projects.webapp.name} (env: ${env.NODE_ENV})';
      const result = parser.parseTemplate(template);

      expect(result.references).toHaveLength(3);
      expect(result.references[0]).toEqual({
        type: 'service',
        name: 'database',
        property: 'url',
        fullPath: 'services.database.url',
        raw: '${services.database.url}',
      });
      expect(result.references[1]).toEqual({
        type: 'project',
        name: 'webapp',
        property: 'name',
        fullPath: 'projects.webapp.name',
        raw: '${projects.webapp.name}',
      });
      expect(result.references[2]).toEqual({
        type: 'env',
        name: 'NODE_ENV',
        property: '',
        fullPath: 'env.NODE_ENV',
        raw: '${env.NODE_ENV}',
      });
    });
  });

  describe('resolveTemplate', () => {
    it('should resolve simple service references', async () => {
      const template = '${services.api.url}';
      const context = {
        services: {
          api: { url: 'https://api.example.com' },
        },
        projects: {},
        env: {},
      };

      const result = await parser.resolveTemplate(template, context);

      expect(result).toEqual({
        success: true,
        resolved: 'https://api.example.com',
        errors: [],
      });
    });

    it('should resolve mixed templates', async () => {
      const template = 'Database: ${services.db.url}, Project: ${projects.app.name}';
      const context = {
        services: {
          db: { url: 'postgresql://db:5432/myapp' },
        },
        projects: {
          app: { name: 'MyApp' },
        },
        env: {},
      };

      const result = await parser.resolveTemplate(template, context);

      expect(result).toEqual({
        success: true,
        resolved: 'Database: postgresql://db:5432/myapp, Project: MyApp',
        errors: [],
      });
    });

    it('should handle missing references', async () => {
      const template = '${services.nonexistent.url}';
      const context = {
        services: {},
        projects: {},
        env: {},
      };

      const result = await parser.resolveTemplate(template, context);

      expect(result).toEqual({
        success: false,
        resolved: template,
        errors: [
          {
            type: 'resolution_error',
            message: 'Cannot resolve reference: services.nonexistent.url',
            reference: 'services.nonexistent.url',
            raw: '${services.nonexistent.url}',
          },
        ],
      });
    });

    it('should handle nested property access', async () => {
      const template = '${services.api.config.database.host}';
      const context = {
        services: {
          api: {
            config: {
              database: {
                host: 'db.example.com',
              },
            },
          },
        },
        projects: {},
        env: {},
      };

      const result = await parser.resolveTemplate(template, context);

      expect(result).toEqual({
        success: true,
        resolved: 'db.example.com',
        errors: [],
      });
    });

    it('should handle missing nested properties', async () => {
      const template = '${services.api.missing.property}';
      const context = {
        services: {
          api: { url: 'https://api.example.com' },
        },
        projects: {},
        env: {},
      };

      const result = await parser.resolveTemplate(template, context);

      expect(result).toEqual({
        success: false,
        resolved: template,
        errors: [
          {
            type: 'resolution_error',
            message: 'Cannot resolve reference: services.api.missing.property',
            reference: 'services.api.missing.property',
            raw: '${services.api.missing.property}',
          },
        ],
      });
    });
  });

  describe('validateTemplate', () => {
    it('should validate correct templates', () => {
      const template = '${services.api.url}/${projects.app.version}';
      const result = parser.validateTemplate(template);

      expect(result).toEqual({
        isValid: true,
        errors: [],
        warnings: [],
      });
    });

    it('should detect syntax errors', () => {
      const template = '${invalid syntax}';
      const result = parser.validateTemplate(template);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('invalid_reference');
    });

    it('should provide warnings for complex references', () => {
      const template = '${services.api.very.deeply.nested.property}';
      const result = parser.validateTemplate(template);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe('deep_nesting_warning');
      expect(result.warnings[0].message).toContain('deeply nested');
    });

    it('should warn about potential circular references', () => {
      const templates = [
        '${services.a.value}',
        '${services.b.value}',
      ];

      const context = {
        'services.a.value': '${services.b.value}',
        'services.b.value': '${services.a.value}',
      };

      const result = parser.detectCircularReferences(templates, context);

      expect(result.hasCircularReferences).toBe(true);
      expect(result.cycles).toHaveLength(1);
      expect(result.cycles[0]).toEqual(['services.a.value', 'services.b.value']);
    });
  });

  describe('detectCircularReferences', () => {
    it('should detect direct circular references', () => {
      const templates = ['${services.a.value}', '${services.b.value}'];
      const context = {
        'services.a.value': '${services.b.value}',
        'services.b.value': '${services.a.value}',
      };

      const result = parser.detectCircularReferences(templates, context);

      expect(result.hasCircularReferences).toBe(true);
      expect(result.cycles).toHaveLength(1);
    });

    it('should detect indirect circular references', () => {
      const templates = ['${services.a.value}', '${services.b.value}', '${services.c.value}'];
      const context = {
        'services.a.value': '${services.b.value}',
        'services.b.value': '${services.c.value}',
        'services.c.value': '${services.a.value}',
      };

      const result = parser.detectCircularReferences(templates, context);

      expect(result.hasCircularReferences).toBe(true);
      expect(result.cycles).toHaveLength(1);
      expect(result.cycles[0]).toEqual(['services.a.value', 'services.b.value', 'services.c.value']);
    });

    it('should not detect circular references when none exist', () => {
      const templates = ['${services.a.value}', '${services.b.value}'];
      const context = {
        'services.a.value': 'static-value',
        'services.b.value': '${services.a.value}',
      };

      const result = parser.detectCircularReferences(templates, context);

      expect(result.hasCircularReferences).toBe(false);
      expect(result.cycles).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should handle escaped dollar signs', () => {
      const template = 'Price: \\$100 and ${services.api.url}';
      const result = parser.parseTemplate(template);

      expect(result.references).toHaveLength(1);
      expect(result.references[0].fullPath).toBe('services.api.url');
    });

    it('should handle multiple dollar signs', () => {
      const template = '$$${services.api.url}$$';
      const result = parser.parseTemplate(template);

      expect(result.references).toHaveLength(1);
    });

    it('should handle nested braces', () => {
      const template = '${services.api.data.{nested}}';
      const result = parser.parseTemplate(template);

      expect(result.isValid).toBe(false);
      expect(result.errors[0].type).toBe('invalid_reference');
    });

    it('should handle empty strings', () => {
      const template = '';
      const result = parser.parseTemplate(template);

      expect(result).toEqual({
        isValid: true,
        references: [],
        errors: [],
      });
    });

    it('should handle very long templates', () => {
      const longTemplate = 'A'.repeat(10000) + '${services.api.url}' + 'B'.repeat(10000);
      const result = parser.parseTemplate(longTemplate);

      expect(result.isValid).toBe(true);
      expect(result.references).toHaveLength(1);
    });
  });
});