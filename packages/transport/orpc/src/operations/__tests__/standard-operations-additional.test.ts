/**
 * Additional tests for standard-operations.ts to increase coverage
 * Focuses on uncovered lines in standard-operations.ts
 */
import { describe, it, expect } from 'vitest';
import z from 'zod/v4';
import { standard } from '@repo/orpc-utils/operations/zod/standard-operations';
import { voidSchema } from '@repo/orpc-utils/types/standard-schema-helpers';
import { getProcedureRoute } from '@repo/orpc-utils/types/type-helpers';

describe('StandardOperations - Additional Coverage', () => {
  const entitySchema = z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.email(),
    age: z.number().optional(),
  });

  describe('List Operation - Advanced Filtering', () => {
    it('should handle list with no options — bare list, no input schema', () => {
      const ops = standard.zod(entitySchema, 'user');
      const contract = ops.list().build();

      expect(contract).toBeDefined();
      // Bare list() has a minimal/void input schema (no pagination, no filters)
      expect(contract['~orpc'].inputSchemas![0]).toBeDefined();
      expect(contract['~orpc'].inputSchemas![0]!['~standard']).toBeDefined();
    });

    it('should handle list with query extensions', () => {
      const ops = standard.zod(entitySchema, 'user');
      const extended = ops.list()
        .input((b) => b.query(z.object({ archived: z.boolean().default(false) })))
        .build();

      expect(extended['~orpc'].inputSchemas![0]).toBeDefined();
    });

    it('can chain .input() on bare list() to add params and query', () => {
      const ops = standard.zod(entitySchema, 'user');
      const contract = ops
        .list()
        .input((b) =>
          b
            .params((p) => p`/${p('orgId', z.string())}`)
            .query(
              z.object({
                prefix: z.string().optional(),
              }),
            ),
        )
        .build();

      type Input = z.infer<NonNullable<NonNullable<typeof contract['~orpc']['inputSchemas']>[0]>>;
      const _inputCheck: Input = {
        params: { orgId: 'org-1' },
        query: { prefix: 'docs/' },
      };

      const inputSchema = contract['~orpc'].inputSchemas![0];
      // Verify the schema was built correctly by checking it has the standard-schema marker
      expect(inputSchema).toBeDefined();
      expect(inputSchema!['~standard']).toBeDefined();
    });
  });

  describe('Create Operation - Validation', () => {
    it('should handle create with required fields only', () => {
      const minimalSchema = z.object({
        id: z.string(),
        name: z.string(),
      });
      const ops = standard.zod(minimalSchema, 'item');
      const contract = ops.create().build();

      expect(getProcedureRoute(contract)?.method).toBe('POST');
      expect(contract['~orpc'].inputSchemas![0]).toBeDefined();
    });

    it('should handle create with nested object schemas', () => {
      const nestedSchema = z.object({
        id: z.string(),
        profile: z.object({
          firstName: z.string(),
          lastName: z.string(),
        }),
      });
      const ops = standard.zod(nestedSchema, 'user');
      const contract = ops.create().build();

      expect(contract['~orpc'].outputSchemas![0]).toBeDefined();
    });

    it('should allow extending create input', () => {
      const ops = standard.zod(entitySchema, 'user');
      const extended = ops.create()
        .input((b) => b.body(z.object({ 
          name: z.string(),
          email: z.string(),
          sendWelcomeEmail: z.boolean().default(true),
        })))
        .build();

      expect(extended['~orpc'].inputSchemas![0]).toBeDefined();
    });
  });

  describe('Read Operation - Variants', () => {
    it('should handle read with UUID id type', () => {
      const ops = standard.zod(entitySchema, 'user');
      const contract = ops.read().build();

      expect(getProcedureRoute(contract)?.path).toContain('{id}');
    });

    it('should handle read with custom id type', () => {
      const customIdSchema = z.object({
        id: z.string().regex(/^[0-9]+$/),
        name: z.string(),
      });
      const ops = standard.zod(customIdSchema, 'record');
      const contract = ops.read({ idSchema: z.string().regex(/^[0-9]+$/) }).build();

      expect(contract['~orpc'].inputSchemas![0]).toBeDefined();
    });

    it('should allow extending read with query params', () => {
      const ops = standard.zod(entitySchema, 'user');
      const extended = ops.read()
        .input((b) => b.query(z.object({ include: z.array(z.string()).optional() })))
        .build();

      expect(extended['~orpc'].inputSchemas![0]).toBeDefined();
    });
  });

  describe('Update Operation - Partial Updates', () => {
    it('should handle patch with all optional fields', () => {
      const ops = standard.zod(entitySchema, 'user');
      const contract = ops.patch().build(); 

      expect(getProcedureRoute(contract)?.method).toBe('PATCH');
      expect(getProcedureRoute(contract)?.path).toContain('{id}');
    });

    it('should handle update with nested optional schemas', () => {
      const nestedSchema = z.object({
        id: z.string(),
        settings: z.object({
          theme: z.enum(['light', 'dark']),
          notifications: z.boolean(),
        }),
      });
      const ops = standard.zod(nestedSchema, 'userSettings');
      const contract = ops.update().build();

      expect(contract['~orpc'].outputSchemas![0]).toBeDefined();
    });

    it('should allow custom update response', () => {
      const ops = standard.zod(entitySchema, 'user');
      const extended = ops.update()
        .output(z.object({ 
          id: z.string(),
          name: z.string(),
          updatedAt: z.date(),
        }))
        .build();

      expect(extended['~orpc'].outputSchemas![0]).toBeDefined();
    });
  });

  describe('Delete Operation - Soft vs Hard Delete', () => {
    it('should handle delete with default void response', () => {
      const ops = standard.zod(entitySchema, 'user');
      const contract = ops.delete().build();

      expect(getProcedureRoute(contract)?.method).toBe('DELETE');
      expect(getProcedureRoute(contract)?.path).toContain('{id}');
    });

    it('should handle delete with custom confirmation response', () => {
      const ops = standard.zod(entitySchema, 'user');
      const extended = ops.delete()
        .output(z.object({ deleted: z.boolean(), deletedAt: z.string() }))
        .build();

      expect(extended['~orpc'].outputSchemas![0]).toBeDefined();
    });

    it('should allow query params for soft delete', () => {
      const ops = standard.zod(entitySchema, 'user');
      const extended = ops.delete()
        .input((b) => b.query(z.object({ soft: z.boolean().default(false) })))
        .build();

      expect(extended['~orpc'].inputSchemas![0]).toBeDefined();
    });
  });

  describe('Count Operation - Filtering', () => {
    it('should handle count with search filters', () => {
      const ops = standard.zod(entitySchema, 'user');
      const contract = ops.count().build();

      expect(contract['~orpc'].outputSchemas![0]).toBeDefined();
    });

    it('should handle count with custom query filters', () => {
      const ops = standard.zod(entitySchema, 'user');
      const extended = ops.count()
        .input((b) => b.query(z.object({ 
          active: z.boolean().optional(),
          createdAfter: z.date().optional(),
        })))
        .build();

      expect(extended['~orpc'].inputSchemas![0]).toBeDefined();
    });
  });

  describe('Check Operation - Validation', () => {
    it('should handle check with default email validation', () => {
      const ops = standard.zod(entitySchema, 'user');
      const contract = ops.check('email').build();

      expect(contract['~orpc'].inputSchemas![0]).toBeDefined();
      expect(contract['~orpc'].outputSchemas![0]).toBeDefined();
    });

    it('should handle check without email field in schema', () => {
      const noEmailSchema = z.object({
        id: z.string(),
        username: z.string(),
      });
      const ops = standard.zod(noEmailSchema, 'account');
      
      // check should still be available but may not make sense
      expect(ops.check).toBeDefined();
      const contract = ops.check('username', z.string()).build();
      expect(contract).toBeDefined();
    });
  });

  describe('Options Configuration', () => {
    it('should handle pascal case entity names', () => {
      const ops = standard.zod(entitySchema, 'userProfile');
      const listContract = ops.list().build();

      expect(getProcedureRoute(listContract)?.summary).toBe('List userProfiles');
    });

    it('should handle plural entity names correctly', () => {
      const ops = standard.zod(entitySchema, 'category');
      const listContract = ops.list().build();

      // Should pluralize entity name by appending "s"
      expect(getProcedureRoute(listContract)?.summary).toBe('List categorys');
    });
  });

  describe('Schema Extraction Edge Cases', () => {
    it('should handle entity schema with many optional fields', () => {
      const optionalSchema = z.object({
        id: z.string(),
        field1: z.string().optional(),
        field2: z.number().optional(),
        field3: z.boolean().optional(),
        field4: z.array(z.string()).optional(),
      });
      const ops = standard.zod(optionalSchema, 'flexible');
      const updateContract = ops.update().build();

      expect(updateContract['~orpc'].inputSchemas![0]).toBeDefined();
    });

    it('should handle entity schema with default values', () => {
      const defaultSchema = z.object({
        id: z.uuid(),
        status: z.enum(['active', 'inactive']).default('active'),
        priority: z.number().default(0),
      });
      const ops = standard.zod(defaultSchema, 'task');
      const createContract = ops.create().build();

      expect(createContract['~orpc'].inputSchemas![0]).toBeDefined();
    });

    it('should handle entity schema with enums', () => {
      const enumSchema = z.object({
        id: z.string(),
        role: z.enum(['admin', 'user', 'guest']),
        status: z.enum(['active', 'suspended', 'deleted']),
      });
      const ops = standard.zod(enumSchema, 'account');
      const listContract = ops.list().build();

      expect(listContract['~orpc'].inputSchemas![0]).toBeDefined();
    });

    it('should handle entity schema with arrays', () => {
      const arraySchema = z.object({
        id: z.string(),
        tags: z.array(z.string()),
        permissions: z.array(z.enum(['read', 'write', 'delete'])),
      });
      const ops = standard.zod(arraySchema, 'resource');
      const createContract = ops.create().build();

      expect(createContract['~orpc'].inputSchemas![0]).toBeDefined();
    });

    it('should handle entity schema with records', () => {
      const recordSchema = z.object({
        id: z.string(),
        metadata: z.record(z.string(), z.unknown()),
        config: z.record(z.string(), z.number()),
      });
      const ops = standard.zod(recordSchema, 'entity');
      const updateContract = ops.update().build();

      expect(updateContract['~orpc'].inputSchemas![0]).toBeDefined();
    });
  });

  describe('Operation Chaining', () => {
    it('should allow chaining multiple modifications on list', () => {
      const ops = standard.zod(entitySchema, 'user');
      const contract = ops.list()
        .input((b) => b.query(z.object({ role: z.string().optional() })))
        .output(z.object({ items: z.array(entitySchema), total: z.number(), hasNext: z.boolean() }))
        .summary('Advanced user listing')
        .build();

      expect(getProcedureRoute(contract)?.summary).toBe('Advanced user listing');
    });

    it('should allow chaining multiple modifications on create', () => {
      const ops = standard.zod(entitySchema, 'user');
      const contract = ops.create()
        .input((b) => b
          .body(z.object({ name: z.string(), email: z.string() }))
          .headers(z.object({ 'x-tenant-id': z.string() }))
        )
        .output(z.object({ id: z.string(), name: z.string(), createdAt: z.string() }))
        .tags('users', 'management')
        .build();

      expect(getProcedureRoute(contract)?.tags).toContain('users');
      expect(getProcedureRoute(contract)?.tags).toContain('management');
    });

    it('should allow chaining multiple modifications on update', () => {
      const ops = standard.zod(entitySchema, 'user');
      const contract = ops.update()
        .input((b) => b.query(z.object({ validate: z.boolean().default(true) })))
        .output(entitySchema)
        .description('Updates user profile with validation')
        .build();

      expect(getProcedureRoute(contract)?.description).toContain('validation');
    });
  });
});
