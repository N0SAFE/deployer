/**
 * Standard Operations - Unified Entry Point
 * 
 * Provides a single `standard` object with methods for different validation libraries.
 * Currently supports Zod-based standard operations.
 * 
 * @example
 * ```typescript
 * import { standard } from '@repo/orpc-utils';
 * import { z } from 'zod/v4';
 * 
 * const userSchema = z.object({
 *   id: z.uuid(),
 *   name: z.string(),
 *   email: z.string().email(),
 * });
 * 
 * // Create Zod-based standard operations
 * const userOps = standard.zod(userSchema, 'user');
 * 
 * // Use the operations
 * const readContract = userOps.read().build();
 * const listContract = userOps.list().build();
 * ```
 */

// Re-export all Zod standard operations from canonical location
export * from "../operations/zod/standard-operations";
export { type ZodEntitySchema, type ZodEntityOperationOptions } from "../operations/zod/standard-operations";

// Re-export list builder
export { ListOperationBuilder, createListConfig, createFilterConfig, type BuilderFilterField } from "../operations/zod/list-builder";

// Re-export base standard operations types
export {
    StandardOperations as BaseStandardOperations,
    type EntityOperationOptions,
    type ListOperationOptions,
    type ListPlainOptions,
} from "../operations/base/standard-operations";

// Re-export utilities
export * from "../operations/zod/utils";

// Create the standard operations factory for convenience
import { zodStandard } from "../operations/zod/standard-operations";

export const standard = {
    zod: zodStandard,
};
