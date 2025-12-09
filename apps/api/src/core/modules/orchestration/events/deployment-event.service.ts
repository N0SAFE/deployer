import { Injectable } from '@nestjs/common';
import { BaseEventService } from '@/core/modules/events/base-event.service';
import {
  deploymentEventContracts,
  type DeploymentEventInput,
  type DeploymentProgressOutput,
  type DeploymentStatusOutput,
  type DeploymentLogOutput,
  type DeploymentPhase,
} from './deployment-event.contracts';

/**
 * DeploymentEventService
 * 
 * Provides real-time event streaming for deployment operations.
 * Extends BaseEventService and uses type-safe event contracts.
 * 
 * Events:
 * - deployProgress: Track deployment phase progress
 * - deploymentStatus: Status change notifications
 * - deploymentLog: Real-time log streaming
 * 
 * @example
 * ```typescript
 * // Subscribe to progress events
 * const subscription = eventService.subscribeToProgress({ deploymentId: 'deploy_123' });
 * for await (const event of subscription) {
 *   console.log(`Phase: ${event.phase}, Progress: ${event.progress}%`);
 * }
 * 
 * // Emit a progress update
 * eventService.emitProgress(
 *   { deploymentId: 'deploy_123' },
 *   'building',
 *   50,
 *   'Building Docker image...'
 * );
 * ```
 */
@Injectable()
export class DeploymentEventService extends BaseEventService<typeof deploymentEventContracts> {
  constructor() {
    super('deployment', deploymentEventContracts);
    this.logger.log('DeploymentEventService initialized');
  }

  // ============================================================================
  // PROGRESS EVENTS
  // ============================================================================

  /**
   * Subscribe to deployment progress events
   */
  subscribeToProgress(filter: DeploymentEventInput) {
    return this.subscribe('deployProgress', filter);
  }

  /**
   * Emit deployment progress event
   */
  emitProgress(
    input: DeploymentEventInput,
    phase: DeploymentPhase,
    progress: number,
    status: string,
    message?: string,
    metadata?: Record<string, unknown>
  ): void {
    const output: DeploymentProgressOutput = {
      phase,
      progress,
      status,
      message,
      metadata,
      timestamp: new Date().toISOString(),
    };
    this.emit('deployProgress', input, output);
    this.logger.debug(`Progress [${input.deploymentId}]: ${phase} - ${String(progress)}% - ${status}`);
  }

  /**
   * Emit phase started event
   */
  emitPhaseStarted(input: DeploymentEventInput, phase: DeploymentPhase): void {
    this.emitProgress(input, phase, 0, `Starting ${phase.replace(/_/g, ' ')}...`);
  }

  /**
   * Emit phase completed event
   */
  emitPhaseCompleted(input: DeploymentEventInput, phase: DeploymentPhase): void {
    this.emitProgress(input, phase, 100, `${phase.replace(/_/g, ' ')} completed`);
  }

  // ============================================================================
  // STATUS EVENTS
  // ============================================================================

  /**
   * Subscribe to deployment status change events
   */
  subscribeToStatus(filter: DeploymentEventInput) {
    return this.subscribe('deploymentStatus', filter);
  }

  /**
   * Emit deployment status change event
   */
  emitStatusChange(
    input: DeploymentEventInput,
    status: DeploymentStatusOutput['status'],
    previousStatus?: string,
    reason?: string,
    error?: string
  ): void {
    const output: DeploymentStatusOutput = {
      previousStatus,
      status,
      reason,
      error,
      timestamp: new Date().toISOString(),
    };
    this.emit('deploymentStatus', input, output);
    this.logger.log(`Status change [${input.deploymentId}]: ${previousStatus ?? 'none'} → ${status}${reason ? ` (${reason})` : ''}`);
  }

  /**
   * Emit deployment queued status
   */
  emitQueued(input: DeploymentEventInput, previousStatus?: string): void {
    this.emitStatusChange(input, 'queued', previousStatus, 'Deployment queued for processing');
  }

  /**
   * Emit deployment building status
   */
  emitBuilding(input: DeploymentEventInput, previousStatus?: string): void {
    this.emitStatusChange(input, 'building', previousStatus, 'Building deployment artifacts');
  }

  /**
   * Emit deployment deploying status
   */
  emitDeploying(input: DeploymentEventInput, previousStatus?: string): void {
    this.emitStatusChange(input, 'deploying', previousStatus, 'Deploying to target environment');
  }

  /**
   * Emit deployment success status
   */
  emitSuccess(input: DeploymentEventInput, previousStatus?: string): void {
    this.emitStatusChange(input, 'success', previousStatus, 'Deployment completed successfully');
  }

  /**
   * Emit deployment failed status
   */
  emitFailed(input: DeploymentEventInput, error: string, previousStatus?: string): void {
    this.emitStatusChange(input, 'failed', previousStatus, 'Deployment failed', error);
  }

  /**
   * Emit deployment cancelled status
   */
  emitCancelled(input: DeploymentEventInput, reason: string, previousStatus?: string): void {
    this.emitStatusChange(input, 'cancelled', previousStatus, reason);
  }

  // ============================================================================
  // LOG EVENTS
  // ============================================================================

  /**
   * Subscribe to deployment log events
   */
  subscribeToLogs(filter: DeploymentEventInput) {
    return this.subscribe('deploymentLog', filter);
  }

  /**
   * Emit a log line
   */
  emitLog(
    input: DeploymentEventInput,
    level: DeploymentLogOutput['level'],
    message: string,
    phase?: DeploymentPhase,
    step?: string
  ): void {
    const output: DeploymentLogOutput = {
      level,
      message,
      phase,
      step,
      timestamp: new Date().toISOString(),
    };
    this.emit('deploymentLog', input, output);
    
    // Also log to the console based on level
    switch (level) {
      case 'debug':
        this.logger.debug(`[${input.deploymentId}] ${message}`);
        break;
      case 'info':
        this.logger.log(`[${input.deploymentId}] ${message}`);
        break;
      case 'warn':
        this.logger.warn(`[${input.deploymentId}] ${message}`);
        break;
      case 'error':
        this.logger.error(`[${input.deploymentId}] ${message}`);
        break;
    }
  }

  /**
   * Emit debug log
   */
  debug(input: DeploymentEventInput, message: string, phase?: DeploymentPhase, step?: string): void {
    this.emitLog(input, 'debug', message, phase, step);
  }

  /**
   * Emit info log
   */
  info(input: DeploymentEventInput, message: string, phase?: DeploymentPhase, step?: string): void {
    this.emitLog(input, 'info', message, phase, step);
  }

  /**
   * Emit warning log
   */
  warn(input: DeploymentEventInput, message: string, phase?: DeploymentPhase, step?: string): void {
    this.emitLog(input, 'warn', message, phase, step);
  }

  /**
   * Emit error log
   */
  error(input: DeploymentEventInput, message: string, phase?: DeploymentPhase, step?: string): void {
    this.emitLog(input, 'error', message, phase, step);
  }

  // ============================================================================
  // CONVENIENCE METHODS
  // ============================================================================

  /**
   * Build full event name using deploymentId as primary key
   * @override
   */
  protected buildFullEventName(
    eventName: string,
    input: Record<string, unknown>
  ): string {
    // Use deploymentId as the primary identifier for event routing
    const deploymentId = input.deploymentId as string;
    return `${this.eventPrefix}:${eventName}:${deploymentId}`;
  }
}
