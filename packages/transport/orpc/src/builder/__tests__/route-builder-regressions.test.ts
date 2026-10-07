import { describe, expect, expectTypeOf, it } from 'vitest';
import z from 'zod/v4';
import { RouteBuilder, route } from '@repo/orpc-utils/builder/core/route-builder';
import type { InferSchemaInput } from '@repo/orpc-utils/types/types';
import { getProcedureRoute } from '@repo/orpc-utils/types/type-helpers';

const SHAPE_SYMBOL = Symbol.for('standard-schema:shape');

function getSchemaShape(value: unknown): Record<string, unknown> {
  return ((value as Record<symbol, unknown>)[SHAPE_SYMBOL] ?? {}) as Record<string, unknown>;
}

describe('RouteBuilder - Regression Coverage', () => {
  describe('static probe factories', () => {
    it('builds health probe with default path and GET method', () => {
      const contract = RouteBuilder.health().build();

      expect(getProcedureRoute(contract)?.path).toBe('/health');
      expect(getProcedureRoute(contract)?.method).toBe('GET');
      expect(contract['~orpc'].outputSchemas![0]).toBeDefined();
    });

    it('builds ready and live probes with custom paths', () => {
      const ready = RouteBuilder.ready({ path: '/probe/ready' }).build();
      const live = RouteBuilder.live({ path: '/probe/live' }).build();

      expect(getProcedureRoute(ready)?.path).toBe('/probe/ready');
      expect(getProcedureRoute(ready)?.method).toBe('GET');
      expect(getProcedureRoute(live)?.path).toBe('/probe/live');
      expect(getProcedureRoute(live)?.method).toBe('GET');
    });
  });

  describe('method/path metadata consistency', () => {
    it('keeps explicit method when route metadata does not provide one', () => {
      const contract = route({ path: '/users' })
        .method('PATCH')
        .input(z.object({ id: z.string() }))
        .output(z.object({ updated: z.boolean() }))
        .build();

      expect(getProcedureRoute(contract)?.method).toBe('PATCH');
      expect(getProcedureRoute(contract)?.path).toBe('/users');
    });

    it('propagates path from input(...params...) template builder', () => {
      const contract = new RouteBuilder({ method: 'GET' })
        .input((b) => b.params((p) => p`/orgs/${p('orgId', z.uuid())}/users/${p('userId', z.uuid())}`))
        .output(z.object({ id: z.string() }))
        .build();

      expect(getProcedureRoute(contract)?.path).toBe('/orgs/{orgId}/users/{userId}');
    });
  });

  describe('legacy callable accessor compatibility', () => {
    it('exposes entitySchema via getEntitySchema()', () => {
      const entitySchema = z.object({ id: z.string(), name: z.string() });
      const builder = new RouteBuilder().entity(entitySchema);

      expect(builder.getEntitySchema()).toBe(entitySchema);
    });

    it('uses a concrete default entity schema when none is provided', () => {
      const builder = new RouteBuilder();

      expect(builder.getEntitySchema()).toBeDefined();
    });
  });

  describe('build-time schema normalization', () => {
    it('preserves body key in inferred input when body fields are all optional', () => {
      const contract = new RouteBuilder({ method: 'POST' })
        .input((b) =>
          b
            .params((p) => p`/deployments/${p('id', z.uuid())}/cancel`)
            .body(z.object({ reason: z.string().optional() }))
        )
        .output(z.object({ success: z.boolean() }))
        .build();

      expect(contract['~orpc'].inputSchemas![0]).toBeDefined();

      type Input = InferSchemaInput<NonNullable<NonNullable<typeof contract['~orpc']['inputSchemas']>[0]>>;

      expectTypeOf<Input>().toHaveProperty('params');
      expectTypeOf<Input>().toHaveProperty('body');
      expectTypeOf<Input['body']>().toMatchTypeOf<{ reason?: string | undefined } | undefined>();
    });

    it('compacts detailed input by removing void-like fields', () => {
      const contract = new RouteBuilder({ method: 'POST' })
        .input((b) =>
          b
            .body(z.object({ name: z.string(), email: z.email() }))
            .query(z.object({ locale: z.string().optional() }))
        )
        .output(z.object({ id: z.string() }))
        .build();

      const inputShape = getSchemaShape(contract['~orpc'].inputSchemas![0]);
      expect(inputShape).toBeDefined();
      expect(inputShape.body).toBeDefined();
      expect(inputShape.query).toBeDefined();

      // params and headers should be normalized to empty object schemas
      const paramsShape = getSchemaShape(inputShape.params);
      const headersShape = getSchemaShape(inputShape.headers);
      expect(Object.keys(paramsShape)).toHaveLength(0);
      expect(Object.keys(headersShape)).toHaveLength(0);
    });

    it('compacts detailed output by omitting empty headers/body for status-only responses', () => {
      const contract = new RouteBuilder({ method: 'DELETE' })
        .output((b) => b.status(204))
        .build();

      const outputShape = getSchemaShape(contract['~orpc'].outputSchemas![0]);
      expect(outputShape).toBeDefined();
      expect(outputShape.status).toBeDefined();

      const headersShape = getSchemaShape(outputShape.headers);
      expect(Object.keys(headersShape)).toHaveLength(0);
      if (outputShape.body === undefined) {
        expect(outputShape.body).toBeUndefined();
      } else {
        const bodyShape = getSchemaShape(outputShape.body);
        expect(Object.keys(bodyShape)).toHaveLength(0);
      }
    });

    it('keeps headers/body in output when explicitly set', () => {
      const contract = new RouteBuilder({ method: 'GET' })
        .output((b) =>
          b
            .status(200)
            .headers({ etag: z.string() })
            .body(z.object({ data: z.array(z.string()) }))
        )
        .build();

      const outputShape = getSchemaShape(contract['~orpc'].outputSchemas![0]);
      expect(outputShape.status).toBeDefined();
      expect(outputShape.headers).toBeDefined();
      expect(outputShape.body).toBeDefined();
    });
  });
});
