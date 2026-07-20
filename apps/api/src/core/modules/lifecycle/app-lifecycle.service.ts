/**
 * AppLifecycleService — Tracks the application lifecycle phases.
 *
 * The app transitions through well-defined phases during startup.
 * Each phase is emitted as an event so subscribers (health endpoint,
 * orchestration, modules) can react accordingly.
 *
 * Phases:
 *   initialized          → App module loaded, HTTP server starting
 *   bootstrapping.config  → Config sub-app running
 *   bootstrapping.setup   → Setup wizard sub-app running (if needed)
 *   bootstrapping.database → Database sub-app running
 *   bootstrapping.auth    → Auth sub-app running
 *   bootstrapping.mesh    → Mesh sub-app running
 *   bootstrapping.docker  → Docker sub-app running
 *   ready                → All sub-apps completed, full functionality
 *   error                → Irrecoverable error during bootstrap
 */

import { Injectable } from '@nestjs/common';
import { Subject, Observable, filter as rxFilter } from 'rxjs';
import { map } from 'rxjs/operators';

export enum AppLifecyclePhase {
  INITIALIZED = 'initialized',
  BOOTSTRAPPING = 'bootstrapping',
  READY = 'ready',
  ERROR = 'error',
}

export enum BootstrapStep {
  DEV = 'dev',
  CONFIG = 'config',
  SETUP_WIZARD = 'setupWizard',
}

export interface AppLifecycleEvent {
  phase: AppLifecyclePhase;
  step?: BootstrapStep;
  message?: string;
  timestamp: string;
  error?: string;
}

@Injectable()
export class AppLifecycleService {
  private readonly events$ = new Subject<AppLifecycleEvent>();
  private _phase: AppLifecyclePhase = AppLifecyclePhase.INITIALIZED;
  private _currentStep: BootstrapStep | null = null;
  private _error: string | null = null;

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
    };
  }

  // ─── State transitions ─────────────────────────────────────────────────────

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
    // Step completed — phase stays bootstrapping until all steps done
  }

  /** Transition to ready. */
  markReady(): void {
    this._phase = AppLifecyclePhase.READY;
    this._currentStep = null;
    this.emit({
      phase: AppLifecyclePhase.READY,
      message: 'Application is fully ready',
    });
  }

  /** Transition to error. */
  markError(error: string): void {
    this._phase = AppLifecyclePhase.ERROR;
    this._error = error;
    this.emit({
      phase: AppLifecyclePhase.ERROR,
      message: `Bootstrap failed: ${error}`,
      error,
    });
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
      case AppLifecyclePhase.BOOTSTRAPPING:
        return `Bootstrapping: ${this._currentStep ?? 'unknown'}`;
      case AppLifecyclePhase.READY:
        return 'Application is fully operational';
      case AppLifecyclePhase.ERROR:
        return `Bootstrap failed: ${this._error ?? 'unknown error'}`;
    }
  }
}
