/**
 * @fileoverview Smart cache invalidation strategies
 * 
 * Provides intelligent cache invalidation based on:
 * - Operation semantics (create/update/delete)
 * - Entity relationships (parent/child)
 * - Data dependencies (list depends on items)
 */

import { autoInvalidate } from '@repo/orpc-utils/hooks/invalidation/auto';
import { invalidateProcedure, refetchProcedure } from '@repo/orpc-utils/hooks/invalidation/query-key';
import type {
  InvalidationStrategy,
  ProcedureInvalidationConfig,
  ProcedureInvalidator,
} from '@repo/orpc-utils/hooks/invalidation/types';

export type {
  InvalidationStrategy,
  ProcedureInvalidationConfig,
  ProcedureInvalidator,
} from '@repo/orpc-utils/hooks/invalidation/types';

/**
 * Create a procedure invalidator with smart defaults
 */
export function createProcedureInvalidator(
  router: Record<string, unknown>,
  defaults?: {
    strategy?: InvalidationStrategy;
    autoDetect?: boolean;
  }
): ProcedureInvalidator {
  const rules = new Map<string, ProcedureInvalidationConfig>();
  
  return {
    onMutation(mutationName: string, config: ProcedureInvalidationConfig) {
      rules.set(mutationName, {
        strategy: defaults?.strategy ?? 'hybrid',
        ...config
      });
    },
    
    async invalidate(queryClient, mutationName, variables, data) {
      const config = rules.get(mutationName);
      
      if (!config) {
        // Use auto-detection if enabled
        if (defaults?.autoDetect) {
          await autoInvalidate(queryClient, router, mutationName, variables);
        }
        return;
      }
      
      // Execute custom logic first
      if (config.custom) {
        await config.custom(queryClient, variables, data);
      }
      
      // Handle standard invalidations
      if (config.invalidate) {
        for (const procedureName of config.invalidate) {
          await invalidateProcedure(queryClient, router, procedureName);
        }
      }
      
      // Handle refetches
      if (config.refetch) {
        for (const procedureName of config.refetch) {
          await refetchProcedure(queryClient, router, procedureName);
        }
      }
    },
    
    getRules() {
      return Object.fromEntries(rules);
    }
  };
}

export { commonPatterns } from '@repo/orpc-utils/hooks/invalidation/patterns';
