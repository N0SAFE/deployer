import { Injectable } from '@nestjs/common';
import { BasePooledEventService } from '@/core/modules/events/services/base-pooled-event.service';
import {
  traefikEventContracts,
  type ConfigSyncInput,
  type ConfigSyncOutput,
  type ConfigChangeInput,
  type ConfigChangeOutput,
  type ValidationResultInput,
  type ValidationResultOutput,
  type CleanupInput,
  type CleanupOutput,
} from './traefik-event.contracts';
import { CoreEventStreamPoolService } from '@/core/modules/events/services/core-event-stream-pool.service';

/**
 * TraefikEventService
 * 
 * Provides real-time event streaming for Traefik configuration operations.
 * Extends BaseEventService and uses type-safe event contracts.
 * 
 * Events:
 * - configSync: Track synchronization progress (database → filesystem)
 * - configChange: Notifications for CRUD operations
 * - validationResult: Validation feedback
 * - cleanup: Orphan file cleanup progress
 * 
 * @example
 * ```typescript
 * // Subscribe to sync events
 * const subscription = eventService.subscribeToSync({ projectId: 'proj_123' });
 * for await (const event of subscription) {
 *   console.log(`Sync ${event.status}: ${event.current}/${event.total}`);
 * }
 * 
 * // Emit a config change
 * eventService.emitConfigCreated('cfg_123', 'service', 'proj_456');
 * ```
 */
@Injectable()
export class TraefikEventService extends BasePooledEventService<typeof traefikEventContracts> {
  constructor(streamPool?: CoreEventStreamPoolService) {
    super('traefik', traefikEventContracts, streamPool);
    this.logger.log('TraefikEventService initialized');
  }

  // ============================================================================
  // SYNC EVENTS
  // ============================================================================

  /**
   * Subscribe to configuration sync events
   */
  subscribeToSync(filter: ConfigSyncInput) {
    return this.subscribe('configSync', filter);
  }

  /**
   * Emit sync started event
   */
  emitSyncStarted(input: ConfigSyncInput, total: number): void {
    const output: ConfigSyncOutput = {
      status: 'started',
      configId: input.configId,
      total,
      timestamp: new Date().toISOString(),
    };
    this.emit('configSync', input, output);
    this.logger.debug(`Sync started: ${String(total)} configs to process`);
  }

  /**
   * Emit sync progress event
   */
  emitSyncProgress(input: ConfigSyncInput, current: number, total: number, path: string): void {
    const output: ConfigSyncOutput = {
      status: 'progress',
      configId: input.configId,
      current,
      total,
      path,
      timestamp: new Date().toISOString(),
    };
    this.emit('configSync', input, output);
    this.logger.debug(`Sync progress: ${String(current)}/${String(total)} - ${path}`);
  }

  /**
   * Emit sync complete event
   */
  emitSyncComplete(input: ConfigSyncInput, total: number): void {
    const output: ConfigSyncOutput = {
      status: 'complete',
      configId: input.configId,
      current: total,
      total,
      timestamp: new Date().toISOString(),
    };
    this.emit('configSync', input, output);
    this.logger.log(`Sync complete: ${String(total)} configs synced`);
  }

  /**
   * Emit sync error event
   */
  emitSyncError(input: ConfigSyncInput, error: string): void {
    const output: ConfigSyncOutput = {
      status: 'error',
      configId: input.configId,
      error,
      timestamp: new Date().toISOString(),
    };
    this.emit('configSync', input, output);
    this.logger.error(`Sync error for config ${input.configId ?? 'unknown'}: ${error}`);
  }

  /**
   * Emit sync skipped event (already synced)
   */
  emitSyncSkipped(input: ConfigSyncInput): void {
    const output: ConfigSyncOutput = {
      status: 'skipped',
      configId: input.configId,
      timestamp: new Date().toISOString(),
    };
    this.emit('configSync', input, output);
    this.logger.debug(`Sync skipped for config ${input.configId ?? 'unknown'}`);
  }

  // ============================================================================
  // CONFIG CHANGE EVENTS
  // ============================================================================

  /**
   * Subscribe to configuration change events
   */
  subscribeToChanges(filter: ConfigChangeInput) {
    return this.subscribe('configChange', filter);
  }

  /**
   * Emit config created event
   */
  emitConfigCreated(
    configId: string,
    configType: ConfigChangeOutput['configType'],
    projectId?: string,
    configName?: string,
    metadata?: Record<string, unknown>
  ): void {
    const output: ConfigChangeOutput = {
      action: 'created',
      configId,
      configType,
      configName,
      projectId,
      metadata,
      timestamp: new Date().toISOString(),
    };
    this.emit('configChange', { configId, projectId }, output);
    this.logger.log(`Config created: ${configType} ${configId}`);
  }

  /**
   * Emit config updated event
   */
  emitConfigUpdated(
    configId: string,
    configType: ConfigChangeOutput['configType'],
    projectId?: string,
    configName?: string,
    metadata?: Record<string, unknown>
  ): void {
    const output: ConfigChangeOutput = {
      action: 'updated',
      configId,
      configType,
      configName,
      projectId,
      metadata,
      timestamp: new Date().toISOString(),
    };
    this.emit('configChange', { configId, projectId }, output);
    this.logger.log(`Config updated: ${configType} ${configId}`);
  }

  /**
   * Emit config deleted event
   */
  emitConfigDeleted(
    configId: string,
    configType: ConfigChangeOutput['configType'],
    projectId?: string,
    configName?: string
  ): void {
    const output: ConfigChangeOutput = {
      action: 'deleted',
      configId,
      configType,
      configName,
      projectId,
      timestamp: new Date().toISOString(),
    };
    this.emit('configChange', { configId, projectId }, output);
    this.logger.log(`Config deleted: ${configType} ${configId}`);
  }

  // ============================================================================
  // VALIDATION EVENTS
  // ============================================================================

  /**
   * Subscribe to validation result events
   */
  subscribeToValidation(filter: ValidationResultInput) {
    return this.subscribe('validationResult', filter);
  }

  /**
   * Emit validation result event
   */
  emitValidationResult(
    configId: string,
    isValid: boolean,
    errors: { path: string; code: string; message: string }[] = [],
    warnings: { path: string; code: string; message: string }[] = [],
    unresolvedVariables?: string[]
  ): void {
    const output: ValidationResultOutput = {
      configId,
      isValid,
      errors,
      warnings,
      unresolvedVariables,
      timestamp: new Date().toISOString(),
    };
    this.emit('validationResult', { configId }, output);
    
    if (isValid) {
      this.logger.debug(`Validation passed for config ${configId}`);
    } else {
      this.logger.warn(`Validation failed for config ${configId}: ${String(errors.length)} errors, ${String(warnings.length)} warnings`);
    }
  }

  // ============================================================================
  // CLEANUP EVENTS
  // ============================================================================

  /**
   * Subscribe to cleanup events
   */
  subscribeToCleanup(filter: CleanupInput) {
    return this.subscribe('cleanup', filter);
  }

  /**
   * Emit cleanup started event
   */
  emitCleanupStarted(projectId?: string, total?: number): void {
    const output: CleanupOutput = {
      status: 'started',
      total,
      timestamp: new Date().toISOString(),
    };
    this.emit('cleanup', { projectId }, output);
    this.logger.log(`Cleanup started${projectId ? ` for project ${projectId}` : ''}`);
  }

  /**
   * Emit cleanup progress event
   */
  emitCleanupProgress(projectId: string | undefined, current: number, total: number, path: string): void {
    const output: CleanupOutput = {
      status: 'progress',
      current,
      total,
      path,
      timestamp: new Date().toISOString(),
    };
    this.emit('cleanup', { projectId }, output);
    this.logger.debug(`Cleanup progress: ${String(current)}/${String(total)} - ${path}`);
  }

  /**
   * Emit cleanup complete event
   */
  emitCleanupComplete(projectId: string | undefined, removed: number): void {
    const output: CleanupOutput = {
      status: 'complete',
      removed,
      timestamp: new Date().toISOString(),
    };
    this.emit('cleanup', { projectId }, output);
    this.logger.log(`Cleanup complete: ${String(removed)} files removed`);
  }

  /**
   * Emit cleanup error event
   */
  emitCleanupError(projectId: string | undefined, error: string): void {
    const output: CleanupOutput = {
      status: 'error',
      error,
      timestamp: new Date().toISOString(),
    };
    this.emit('cleanup', { projectId }, output);
    this.logger.error(`Cleanup error: ${error}`);
  }
}
