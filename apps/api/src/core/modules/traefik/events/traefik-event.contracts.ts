import { z } from 'zod/v4';
import { contractBuilder, ProcessingStrategy } from '@/core/modules/events/event-contract.builder';

/**
 * Contract for configuration synchronization events
 * Used to track sync progress from database to real filesystem
 */
export const configSyncContract = contractBuilder()
  .input(z.object({
    configId: z.string().optional(),
    projectId: z.string().optional(),
    serviceId: z.string().optional(),
  }))
  .output(z.object({
    status: z.enum(['started', 'progress', 'complete', 'error', 'skipped']),
    configId: z.string().optional(),
    current: z.number().optional(),
    total: z.number().optional(),
    path: z.string().optional(),
    error: z.string().optional(),
    timestamp: z.string(),
  }))
  .strategy(ProcessingStrategy.QUEUE, {})
  .build();

/**
 * Contract for configuration change events
 * Emitted when configurations are created, updated, or deleted
 */
export const configChangeContract = contractBuilder()
  .input(z.object({
    configId: z.string().optional(),
    projectId: z.string().optional(),
  }))
  .output(z.object({
    action: z.enum(['created', 'updated', 'deleted']),
    configId: z.string(),
    configType: z.enum(['service', 'middleware', 'certificate', 'template', 'static']),
    configName: z.string().optional(),
    projectId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    timestamp: z.string(),
  }))
  .strategy(ProcessingStrategy.PARALLEL)
  .build();

/**
 * Contract for validation result events
 * Emitted when configuration validation is performed
 */
export const validationResultContract = contractBuilder()
  .input(z.object({
    configId: z.string(),
  }))
  .output(z.object({
    configId: z.string(),
    isValid: z.boolean(),
    errors: z.array(z.object({
      path: z.string(),
      code: z.string(),
      message: z.string(),
    })),
    warnings: z.array(z.object({
      path: z.string(),
      code: z.string(),
      message: z.string(),
    })),
    unresolvedVariables: z.array(z.string()).optional(),
    timestamp: z.string(),
  }))
  .strategy(ProcessingStrategy.ABORT, {
    onAbort: (input, { signal: _signal }) => {
      // Log when a validation is aborted (new validation started)
      console.debug(`Validation for config ${input.configId} was aborted`);
    },
  })
  .build();

/**
 * Contract for cleanup events
 * Emitted when orphaned files are cleaned up
 */
export const cleanupContract = contractBuilder()
  .input(z.object({
    projectId: z.string().optional(),
  }))
  .output(z.object({
    status: z.enum(['started', 'progress', 'complete', 'error']),
    removed: z.number().optional(),
    current: z.number().optional(),
    total: z.number().optional(),
    path: z.string().optional(),
    error: z.string().optional(),
    timestamp: z.string(),
  }))
  .strategy(ProcessingStrategy.QUEUE, {})
  .build();

/**
 * All Traefik event contracts
 */
export const traefikEventContracts = {
  configSync: configSyncContract,
  configChange: configChangeContract,
  validationResult: validationResultContract,
  cleanup: cleanupContract,
} as const;

/**
 * Traefik event types
 */
export type TraefikEventContracts = typeof traefikEventContracts;

// Type helpers for contract inputs/outputs
export type ConfigSyncInput = z.infer<typeof configSyncContract.input>;
export type ConfigSyncOutput = z.infer<typeof configSyncContract.output>;
export type ConfigChangeInput = z.infer<typeof configChangeContract.input>;
export type ConfigChangeOutput = z.infer<typeof configChangeContract.output>;
export type ValidationResultInput = z.infer<typeof validationResultContract.input>;
export type ValidationResultOutput = z.infer<typeof validationResultContract.output>;
export type CleanupInput = z.infer<typeof cleanupContract.input>;
export type CleanupOutput = z.infer<typeof cleanupContract.output>;
