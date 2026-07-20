/**
 * BaseTriggerService — Base class for all typed trigger services.
 *
 * Extends BaseEventService to inherit its event infrastructure:
 *   - Zod schema validation at emission time (via EventContract)
 *   - Subject-based Observable for subscriptions
 *   - Durable event buffering (via BaseEventService)
 *   - Automatic service registry (via BaseEventService)
 *
 * Each trigger creates an internal contract with a single "emit" event where:
 *   - input = z.object({}) (triggers have no meaningful input)
 *   - output = the trigger payload schema
 *
 * Usage (sub-app service):
 *   ctx.trigger.emit({ pool, drizzle, isMigrated: true });
 *   ctx.trigger.complete();
 *
 * Usage (main app module factory):
 *   const payload = await dbTrigger.waitFor();
 *   dbTrigger.onValue(event => { ... });
 */

import { type Observable, type Subscription } from 'rxjs';
import { z } from 'zod/v4';
import { BaseEventService } from '@/core/modules/events/base-event.service';
import { contractBuilder } from '@/core/modules/events/event-contract.builder';
import type { EventContract } from '@/core/modules/events/event-contract.builder';

/**
 * Convenience: extract the output (payload) type from a trigger schema.
 */
export type TriggerPayload<TSchema extends z.ZodType> = z.output<TSchema>;

/**
 * Base trigger service — extends BaseEventService.
 *
 * Wraps the event system's emit/subscribe$ for trigger-specific use:
 *   - emit(value)     → internal call to super's 3-arg emit
 *   - onValue()       → subscribe to emissions
 *   - asObservable()  → Observable of emissions
 *   - complete()      → marks completion
 *   - waitFor()       → Promise for the first emission
 */
export class BaseTriggerService<TSchema extends z.ZodType> extends BaseEventService<{
  emit: EventContract<Record<string, never>, z.output<TSchema>>;
}> {
  /**
   * Static registry keyed by bridge class name. Enables cross-context sharing:
   * even when different DI containers create separate instances, they all
   * read/write the same underlying state via the static key.
   */
  private static sharedStates = new Map<string, { value: unknown | null; resolve: ((v: unknown) => void) | null }>();

  private _lastValue: z.output<TSchema> | null = null;
  private _isCompleted = false;

  constructor(
    protected readonly payloadSchema: TSchema,
  ) {
    const contract = contractBuilder()
      .input(z.object({}))
      .output(payloadSchema)
      .build() as EventContract<Record<string, never>, z.output<TSchema>>;

    super('trigger', { emit: contract });
  }

  /** Unique bridge identifier. Set via static bridgeId on subclasses. */
  private get bridgeKey(): string {
    return (this.constructor as typeof BaseTriggerService).bridgeId ?? this.constructor.name;
  }

  /** Shared state keyed by bridgeKey. */
  private get sharedState(): { value: unknown | null; resolve: ((v: unknown) => void) | null } {
    const key = this.bridgeKey;
    if (!BaseTriggerService.sharedStates.has(key)) {
      BaseTriggerService.sharedStates.set(key, { value: null, resolve: null });
    }
    return BaseTriggerService.sharedStates.get(key)!;
  }

  /** Whether this trigger has been completed. */
  get isCompleted(): boolean {
    return this._isCompleted;
  }

  /** The last emitted value. Null if nothing emitted yet. */
  get lastValue(): z.output<TSchema> | null {
    return this._lastValue;
  }

  /**
   * Returns a Promise that resolves on the first emission.
   * If already emitted, returns immediately with the last value.
   * Uses a static shared Promise so it works across DI contexts.
   */
  async waitFor(): Promise<z.output<TSchema>> {
    const st = this.sharedState;
    if (st.value !== null) return st.value as z.output<TSchema>;
    if (!st.resolve) {
      return new Promise<z.output<TSchema>>((resolve) => {
        st.resolve = resolve as (v: unknown) => void;
      });
    }
    // If resolve already exists, chain onto it
    return new Promise<z.output<TSchema>>((resolve) => {
      const origResolve = st.resolve!;
      st.resolve = (v: unknown) => { origResolve(v); resolve(v as z.output<TSchema>); };
    });
  }

  /**
   * Emit a trigger payload. Resolves the shared static Promise and
   * delegates to BaseEventService.emit() for event log/durability.
   *
   * Two call signatures:
   *   - `emit(value)` — convenience
   *   - `emit('emit', {}, value)` — compatible with BaseEventService.emit()
   */
  emit(value: z.output<TSchema>): void;
  emit(eventName: 'emit', input: Record<string, never>, output: z.output<TSchema>): void;
  emit(first: unknown, second?: unknown, third?: unknown): void {
    const value = arguments.length === 1 ? first as z.output<TSchema> : third as z.output<TSchema>;
    this._lastValue = value;

    // Resolve the shared static Promise so waiters in other DI contexts resolve.
    const st = this.sharedState;
    st.value = value;
    st.resolve?.(value);
    st.resolve = null;

    if (arguments.length === 1) {
      BaseEventService.prototype.emit.call(this, 'emit', {}, first);
    } else {
      BaseEventService.prototype.emit.call(this, first, second, third);
    }
  }

  /**
   * Complete the trigger.
   */
  complete(): void {
    if (this._isCompleted) return;
    this._isCompleted = true;
  }

  /**
   * Convenience: waitFor() using shared state with timeout.
   */
  async waitForOrTimeout(timeoutMs = 120_000): Promise<z.output<TSchema>> {
    const st = this.sharedState;
    if (st.value !== null) return st.value as z.output<TSchema>;
    return new Promise<z.output<TSchema>>((resolve, reject) => {
      // If shared resolve already exists, chain it
      if (st.resolve) {
        const originalResolve = st.resolve;
        st.resolve = (v: unknown) => { originalResolve(v); resolve(v as z.output<TSchema>); };
      } else {
        st.resolve = (v: unknown) => resolve(v as z.output<TSchema>);
      }
      const start = Date.now();
      const poll = () => {
        if (st.value !== null) return resolve(st.value as z.output<TSchema>);
        if (Date.now() - start > timeoutMs) {
          st.resolve = null;
          return reject(new Error('waitForOrTimeout timed out'));
        }
        setTimeout(poll, 50);
      };
      poll();
    });
  }

  /**
   * Subscribe to all emissions.
   */
  onValue(next: (value: z.output<TSchema>) => void): Subscription {
    return this.subscribe$('emit', {}).subscribe({ next });
  }

  /**
   * Get the Observable of all emissions.
   */
  get asObservable(): Observable<z.output<TSchema>> {
    return this.subscribe$('emit', {});
  }

  /**
   * Returns a Promise that resolves when complete() is called,
   * returning all emitted values in order.
   */
  async toArray(): Promise<z.output<TSchema>[]> {
    const values: z.output<TSchema>[] = [];
    return new Promise<z.output<TSchema>[]>((resolve, reject) => {
      this.subscribe$('emit', {}).subscribe({
        next: (v: z.output<TSchema>) => { values.push(v); },
        error: (err: Error) => { reject(err); },
        complete: () => { resolve(values); },
      });
    });
  }
}
