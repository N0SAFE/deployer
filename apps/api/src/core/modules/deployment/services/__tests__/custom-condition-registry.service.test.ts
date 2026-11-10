import { describe, it, expect, beforeEach } from 'vitest';
import { CustomConditionRegistry } from '../custom-condition-registry.service';

describe('CustomConditionRegistry', () => {
  let registry: CustomConditionRegistry;

  beforeEach(() => {
    registry = new CustomConditionRegistry();
  });

  it('reports not found for an unregistered condition', async () => {
    await expect(registry.evaluate('missing', {})).resolves.toEqual({ found: false });
  });

  it('evaluates a synchronous predicate and coerces truthiness', async () => {
    registry.register('sync', (ctx: any) => ctx.value === 1);
    await expect(registry.evaluate('sync', { value: 1 })).resolves.toEqual({ found: true, result: true });
    await expect(registry.evaluate('sync', { value: 2 })).resolves.toEqual({ found: true, result: false });
  });

  it('awaits asynchronous predicates', async () => {
    registry.register('async', async () => true);
    await expect(registry.evaluate('async', {})).resolves.toEqual({ found: true, result: true });
  });

  it('returns a false result instead of throwing when a predicate throws', async () => {
    registry.register('boom', () => {
      throw new Error('predicate failed');
    });
    await expect(registry.evaluate('boom', {})).resolves.toEqual({ found: true, result: false });
  });

  it('replaces a predicate registered under the same name', async () => {
    registry.register('dup', () => true);
    registry.register('dup', () => false);
    await expect(registry.evaluate('dup', {})).resolves.toEqual({ found: true, result: false });
  });
});
