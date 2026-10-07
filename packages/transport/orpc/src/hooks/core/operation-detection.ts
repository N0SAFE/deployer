import type { AnySchema } from '@orpc/contract';
import { getAsyncIteratorObjectSchemaDetails } from '@orpc/contract';
import { hasRouteMethodMeta, getRouteMethod } from '@repo/orpc-utils/types/route-method-meta';
import { isContractProcedure } from '@repo/orpc-utils/types/type-helpers';
import { getObservableSchemaDetails } from '@repo/orpc-utils/observable/contract';

/**
 * Extended operation type supporting all ORPC operation types.
 */
export type OperationType = 'query' | 'mutation' | 'streaming' | 'unsupported';

/**
 * Contract procedure metadata structure.
 *
 * oRPC v2 stores schemas as arrays (`inputSchemas` / `outputSchemas`) because
 * `.input()` / `.output()` now stack; the builder applies one of each, so the
 * relevant schema is index 0.
 */
export type ContractProcedureMetadata = {
  meta?: Record<string, unknown>;
  outputSchemas?: AnySchema[];
  inputSchemas?: AnySchema[];
};

/**
 * Check if a schema represents an event-iterator output (streaming).
 */
export function isEventIteratorOutput(outputSchema: AnySchema | undefined): boolean {
  if (!outputSchema) return false;
  return getAsyncIteratorObjectSchemaDetails(outputSchema) !== undefined || getObservableSchemaDetails(outputSchema) !== undefined;
}

/**
 * Detect operation type from RouteBuilder contract metadata.
 */
export function detectOperationType(
  procedure: unknown,
   
  _procedureName?: string
): OperationType {
  if (!isContractProcedure(procedure)) {
    return 'unsupported';
  }

  if (!hasRouteMethodMeta(procedure)) {
    return 'unsupported';
  }

  const def = (procedure as { '~orpc'?: ContractProcedureMetadata })['~orpc'];

  if (def?.outputSchemas?.[0] && isEventIteratorOutput(def.outputSchemas[0])) {
    return 'streaming';
  }

  const method = getRouteMethod(procedure);
  if (method) {
    return method.toUpperCase() === 'GET' ? 'query' : 'mutation';
  }

  return 'unsupported';
}

/**

 * Auto-detect which queries should be invalidated by a mutation.
 */
export function inferInvalidations(mutationName: string, availableQueries: string[]): string[] {
  const invalidations = new Set<string>();
  const lowerMutation = mutationName.toLowerCase();

  if (lowerMutation.includes('create') || lowerMutation.includes('delete') || lowerMutation.includes('update')) {
    availableQueries.forEach(query => {
      if (query.toLowerCase().includes('list') || query.toLowerCase().includes('count')) {
        invalidations.add(query);
      }
    });
  }

  if (lowerMutation.includes('update') || lowerMutation.includes('delete')) {
    availableQueries.forEach(query => {
      if (query.toLowerCase().includes('findbyid') || query.toLowerCase().includes('get')) {
        invalidations.add(query);
      }
    });
  }

  return Array.from(invalidations);
}
