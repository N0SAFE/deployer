/**
 * AppLifecycleService — Tracks the application lifecycle phases.
 *
 * The app transitions through well-defined phases during startup and runtime.
 * Each phase is emitted as an event so subscribers (health endpoint,
 * orchestration, modules) can react accordingly.
 *
 * The service is purely a state observer — it NEVER calls process.exit() or
 * performs any side effects. External code (the orchestrator, health endpoint)
 * decides what actions to take based on state transitions.
 *
 * Phases:
 *   initialized          → App module loaded, HTTP server starting
 *   discovering          → Resolving database URL (mesh → SQLite cache)
 *   probing              → Testing DB connectivity (SELECT 1)
 *   bootstrapping.*      → Sub-app bootstrap steps
 *   ready                → All sub-apps completed, full functionality
 *   degraded             → DB lost mid-run, recovery loop active
 *   error                → Irrecoverable error during bootstrap
 */

import { Injectable } from '@nestjs/common';
import { Subject, Observable, filter as rxFilter } from 'rxjs';

export enum AppLifecyclePhase {
  INITIALIZED = 'initialized',
  DISCOVERING = 'discovering',
  PROBING = 'probing',
  BOOTSTRAPPING = 'bootstrapping',
  JOINING_MESH = 'joining_mesh',
  READY = 'ready',
  DEGRADED = 'degraded',
  ERROR = 'error',
}

export enum BootstrapStep {
  DEV = 'dev',
  CONFIG = 'config',
  SETUP_WIZARD = 'setupWizard',
  DATABASE = 'database',
  MESH = 'mesh',
}

export type AppLifecycleEvent = {
  phase: AppLifecyclePhase;
  step?: BootstrapStep;
  message?: string;
  timestamp: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AppLifecycleService {
  private readonly events$ = new Subject<AppLifecycleEvent>();
  private _phase: AppLifecyclePhase = AppLifecyclePhase.INITIALIZED;
  private _currentStep: BootstrapStep | null = null;
  private _error: string | null = null;
  private _metadata: Record<string, unknown> = {};

  constructor() {
    // Emit the initial state
    this.emit({
      phase: AppLifecyclePhase.INITIALIZED,
      message: 'Application initialized, starting bootstrap...',
    });
  }

  /** Current lifecycle phase. */
  get phase(): AppLifecyclePhase {
    return this._phase;
  }

  /** Current bootstrap step (only meaningful during BOOTSTRAPPING). */
  get currentStep(): BootstrapStep | null {
    return this._currentStep;
  }

  /** Any error that occurred. */
  get error(): string | null {
    return this._error;
  }

  /** Current metadata snapshot. */
  get metadata(): Readonly<Record<string, unknown>> {
    return this._metadata;
  }

  /** Observable of lifecycle events, filtered by phase. */
  on(event: { phase: AppLifecyclePhase }): Observable<AppLifecycleEvent> {
    return this.events$.pipe(
      rxFilter((e) => e.phase === event.phase),
    );
  }

  /** Observable of all lifecycle events. */
  get events(): Observable<AppLifecycleEvent> {
    return this.events$.asObservable();
  }

  /** Get a snapshot of the current state. */
  getSnapshot(): AppLifecycleEvent {
    return {
      phase: this._phase,
      step: this._currentStep ?? undefined,
      message: this.getDefaultMessage(),
      timestamp: new Date().toISOString(),
      error: this._error ?? undefined,
      metadata: Object.keys(this._metadata).length > 0 ? { ...this._metadata } : undefined,
    };
  }

  // ─── State transitions ─────────────────────────────────────────────────────

  /** Transition to a new phase with optional metadata. Never calls process.exit(). */
  transition(phase: AppLifecyclePhase, metadata?: { error?: string; message?: string } & Record<string, unknown>): void {
    const from = this._phase;
    this._phase = phase;
    this._currentStep = null;

    if (metadata?.error) {
      this._error = metadata.error;
    }
    if (metadata) {
      const { error, message, ...rest } = metadata;
      void error;
      void message;
      Object.assign(this._metadata, rest);
    }

    this.emit({
      phase,
      message: metadata?.message ?? `Transition: ${from} → ${phase}`,
      error: metadata?.error,
      metadata: Object.keys(this._metadata).length > 0 ? { ...this._metadata } : undefined,
    });
  }

  /** Transition to a bootstrap step. */
  enterStep(step: BootstrapStep): void {
    this._phase = AppLifecyclePhase.BOOTSTRAPPING;
    this._currentStep = step;
    this.emit({
      phase: AppLifecyclePhase.BOOTSTRAPPING,
      step,
      message: `Bootstrapping: ${step}`,
    });
  }

  /** Mark a bootstrap step as completed. */
  completeStep(_step: BootstrapStep): void {
    void _step;
    // Step completed — phase stays bootstrapping until all steps done
  }

  /** Transition to ready. */
  markReady(): void {
    this.transition(AppLifecyclePhase.READY, { message: 'Application is fully ready' });
  }

  /** Transition to error. */
  markError(error: string): void {
    this.transition(AppLifecyclePhase.ERROR, { error, message: `Bootstrap failed: ${error}` });
  }

  /** Mark a probed database URL and its reachability status. */
  markDatabaseProbe(url: string, reachable: boolean): void {
    this._metadata.databaseUrl = url;
    this._metadata.databaseReachable = reachable;
  }

  /** Mark mesh connection status. */
  markMeshConnected(connected: boolean): void {
    this._metadata.meshConnected = connected;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private emit(event: Omit<AppLifecycleEvent, 'timestamp'> & { timestamp?: string }): void {
    this.events$.next({
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    });
  }

  private getDefaultMessage(): string {
    switch (this._phase) {
      case AppLifecyclePhase.INITIALIZED:
        return 'Application initialized, awaiting bootstrap';
      case AppLifecyclePhase.DISCOVERING:
        return 'Resolving database URL';
      case AppLifecyclePhase.PROBING:
        return 'Testing database connectivity';
      case AppLifecyclePhase.BOOTSTRAPPING:
        return `Bootstrapping: ${this._currentStep ?? 'unknown'}`;
      case AppLifecyclePhase.JOINING_MESH:
        return 'Connecting to mesh peers';
      case AppLifecyclePhase.READY:
        return 'Application is fully ready';
      case AppLifecyclePhase.DEGRADED:
        return 'Application is running in degraded mode';
      case AppLifecyclePhase.ERROR:
        return `Bootstrap failed: ${this._error ?? 'unknown error'}`;
      default:
        return `Phase: ${String(this._phase)}`;
    }
  }
}
