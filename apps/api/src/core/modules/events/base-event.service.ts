import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { EMPTY, merge, Observable, Subject } from 'rxjs';
import { filter as rxFilter, map } from 'rxjs/operators';
import { observableToAsyncIterable } from '@/core/utils/observable.utils';
import type {
  EventContracts,
  EventContract,
  EventInput,
  EventOutput,
} from './event-contract.builder';
import { isRecord } from '@repo/type-guards';

export const BASE_EVENT_SERVICE_SYMBOL = Symbol.for('core.events.base-service');

export interface BaseEventServiceSymbolized {
  readonly [BASE_EVENT_SERVICE_SYMBOL]: true;
}

export interface BaseEventServiceRegistryEntry {
  namespace: string;
  domainServiceName: string;
  referenceScope: string;
  service: BaseEventService;
}

export interface MergedDomainEventEnvelope {
  namespace: string;
  domainServiceName: string;
  referenceScope: string;
  eventName: string;
  input: Record<string, unknown>;
  output: unknown;
  emittedAt: string;
}

/**
 * Event subscription result
 * Returns an async iterator of the event output type
 */
export type EventSubscription<T extends EventContract> = AsyncIterableIterator<EventOutput<T>>;

export interface AnyEventEmission<T extends EventContract> {
  input: EventInput<T>;
  output: EventOutput<T>;
}

/**
 * Event subscription tracking
 */


interface EventSubscriptionData<T> {
  eventName: string;
  subject: Subject<T>;
  subscriberCount: number;
}

interface BufferedEventRecord {
  eventName: string;
  eventKey: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  sequence: number;
  emittedAt: string;
}

export interface PersistedEventLog {
  namespace: string;
  eventName: string;
  eventKey: string;
  sequence: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  emittedAt: Date;
}

export interface EventLogPersistenceAdapter {
  insertMany(logs: PersistedEventLog[]): Promise<void>;
  findRecentByEventKey(input: {
    namespace: string;
    eventName: string;
    eventKey: string;
    limit: number;
  }): Promise<PersistedEventLog[]>;
  findRecentByEventName(input: {
    namespace: string;
    eventName: string;
    limit: number;
  }): Promise<PersistedEventLog[]>;
}

interface ReplayOptions {
  replayLimit?: number;
  includePersisted?: boolean;
  /**
   * If set, only buffered events with sequence > afterSequence are replayed.
   * Used for cursor-based reconnect: subscribers pass back the last sequence they observed.
   */
  afterSequence?: number;
}

interface QueryByInputOptions<TInput> extends ReplayOptions {
  fuzzy?: string;
  predicate?: (input: TInput) => boolean;
}

/**
 * Base Event Service
 * 
 * Generic base class for feature-specific event services.
 * Provides type-safe event subscription and durable emission buffering with automatic validation.
 * 
 * @template TContracts - Map of event names to their contracts
 * 
 * @example
 * ```typescript
 * // Define contracts
 * const videoContracts = {
 *   processing: createContract({
 *     input: z.object({ videoId: z.string() }),
 *     output: z.object({ progress: z.number(), status: z.string() }),
 *   })
 * } satisfies EventContracts;
 * 
 * // Create event service
 * @Injectable()
 * class VideoEventService extends BaseEventService<typeof videoContracts> {
 *   constructor() {
 *     super('video', videoContracts);
 *   }
 * }
 * ```
 */
export abstract class BaseEventService<
  TContracts extends EventContracts = EventContracts,
  TNamespace extends string = string,
> implements OnModuleDestroy {
  private static persistenceAdapter: EventLogPersistenceAdapter | null = null;
  private static readonly serviceRegistry = new Set<BaseEventService>();

  readonly [BASE_EVENT_SERVICE_SYMBOL] = true as const;

  protected readonly logger: Logger;
  protected readonly eventPrefix: TNamespace;
  private readonly events = new Map<string, EventSubscriptionData<unknown>>();
  private readonly anyEventSubscriptions = new Map<string, EventSubscriptionData<unknown>>();
  private readonly durableEmissionsByKey = new Map<string, BufferedEventRecord[]>();
  private readonly durableEmissionsByEventName = new Map<string, BufferedEventRecord[]>();
  private readonly sequenceByEventKey = new Map<string, number>();
  private readonly pendingPersistence: PersistedEventLog[] = [];

  protected readonly durableReplayLimit = 2_000;
  protected readonly pendingFlushBatchSize = 200;
  protected readonly flushIntervalMs = 3 * 60 * 1000;

  private isFlushing = false;

  constructor(
    eventPrefix: TNamespace,
    protected readonly contracts: TContracts,
  ) {
    this.eventPrefix = eventPrefix;
    this.logger = new Logger(`${eventPrefix}EventService`);
    BaseEventService.registerInstance(this as unknown as BaseEventService);
  }

  get namespace(): TNamespace {
    return this.eventPrefix;
  }

  get domainServiceName(): string {
    return this.constructor.name;
  }

  get referenceScope(): string {
    return this.domainServiceName;
  }

  getContractNames(): (keyof TContracts & string)[] {
    return Object.keys(this.contracts);
  }

  static configurePersistenceAdapter(adapter: EventLogPersistenceAdapter): void {
    BaseEventService.persistenceAdapter = adapter;
  }

  static hasBaseEventSymbol(value: unknown): value is BaseEventServiceSymbolized {
    return (
      typeof value === 'object' &&
      value !== null &&
      BASE_EVENT_SERVICE_SYMBOL in value &&
      (value as Record<symbol, unknown>)[BASE_EVENT_SERVICE_SYMBOL] === true
    );
  }

  static listRegisteredServices(): BaseEventService[] {
    return Array.from(BaseEventService.serviceRegistry);
  }

  static listRegisteredServiceEntries(): BaseEventServiceRegistryEntry[] {
    return BaseEventService.listRegisteredServices().map((service) => ({
      namespace: service.namespace,
      domainServiceName: service.domainServiceName,
      referenceScope: service.referenceScope,
      service,
    }));
  }

  static findRegisteredByNamespace(namespace: string): BaseEventService[] {
    return BaseEventService.listRegisteredServices().filter((service) => service.namespace === namespace);
  }

  static findRegisteredByReferenceScope(referenceScope: string): BaseEventService[] {
    return BaseEventService.listRegisteredServices().filter((service) => service.referenceScope === referenceScope);
  }

  static mergeBuilder(): BaseEventMergeBuilder {
    return new BaseEventMergeBuilder().fromRegistered();
  }

  static clearRegistryForTests(): void {
    BaseEventService.serviceRegistry.clear();
  }

  private static registerInstance(instance: BaseEventService): void {
    BaseEventService.serviceRegistry.add(instance);
  }

  subscribe$<K extends keyof TContracts>(
    eventName: K,
    input: EventInput<TContracts[K]>,
    options?: ReplayOptions,
  ): Observable<EventOutput<TContracts[K]>> {
    const contract = this.contracts[eventName];
    if (!contract) {
      throw new Error(`Contract not found for event: ${String(eventName)}`);
    }

    const validatedInput = contract.input.parse(input) as EventInput<TContracts[K]>;
    const fullEventName = this.buildFullEventName(String(eventName), validatedInput);

    let subscription = this.events.get(fullEventName) as EventSubscriptionData<EventOutput<TContracts[K]>> | undefined;
    if (!subscription) {
      subscription = {
        eventName: fullEventName,
        subject: new Subject<EventOutput<TContracts[K]>>(),
        subscriberCount: 0,
      };
      this.events.set(fullEventName, subscription as unknown as EventSubscriptionData<unknown>);
    }

    subscription.subscriberCount += 1;

    const replayLimit = options?.replayLimit ?? this.durableReplayLimit;
    const includePersisted = options?.includePersisted ?? true;
    const afterSequence = options?.afterSequence;

    return new Observable<EventOutput<TContracts[K]>>((subscriber) => {
      void (async () => {
        try {
          if (includePersisted && BaseEventService.persistenceAdapter) {
            const persisted = await BaseEventService.persistenceAdapter.findRecentByEventKey({
              namespace: this.eventPrefix,
              eventName: String(eventName),
              eventKey: fullEventName,
              limit: replayLimit,
            });

            for (const item of persisted) {
              if (afterSequence != null && item.sequence <= afterSequence) {
                continue;
              }
              subscriber.next(item.output as EventOutput<TContracts[K]>);
            }
          }

          const buffered = this.durableEmissionsByKey.get(fullEventName);
          if (buffered?.length) {
            const window =
              afterSequence != null
                ? buffered.filter((r) => r.sequence > afterSequence)
                : replayLimit > 0
                  ? buffered.slice(-replayLimit)
                  : [];
            for (const item of window) {
              subscriber.next(item.output as EventOutput<TContracts[K]>);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Skipping persisted replay for '${String(eventName)}': ${message}`);
        }
      })();

      const internalSubscription = subscription.subject.subscribe(subscriber);
      return () => {
        internalSubscription.unsubscribe();

        const current = this.events.get(fullEventName);
        if (!current) {
          return;
        }

        current.subscriberCount = Math.max(0, current.subscriberCount - 1);
        if (current.subscriberCount === 0) {
          this.events.delete(fullEventName);
        }
      };
    });
  }

  subscribeAny$<K extends keyof TContracts>(
    eventName: K,
  ): Observable<AnyEventEmission<TContracts[K]>> {
    const contract = this.contracts[eventName];
    if (!contract) {
      throw new Error(`Contract not found for event: ${String(eventName)}`);
    }

    const eventKey = String(eventName);
    let subscription = this.anyEventSubscriptions.get(eventKey) as EventSubscriptionData<AnyEventEmission<TContracts[K]>> | undefined;
    if (!subscription) {
      subscription = {
        eventName: eventKey,
        subject: new Subject<AnyEventEmission<TContracts[K]>>(),
        subscriberCount: 0,
      };
      this.anyEventSubscriptions.set(eventKey, subscription as unknown as EventSubscriptionData<unknown>);
    }

    subscription.subscriberCount += 1;

    return new Observable<AnyEventEmission<TContracts[K]>>((subscriber) => {
      const internalSubscription = subscription.subject.subscribe(subscriber);
      return () => {
        internalSubscription.unsubscribe();

        const current = this.anyEventSubscriptions.get(eventKey);
        if (!current) {
          return;
        }

        current.subscriberCount = Math.max(0, current.subscriberCount - 1);
        if (current.subscriberCount === 0) {
          this.anyEventSubscriptions.delete(eventKey);
        }
      };
    });
  }

  observeAnyByName$(eventName: string): Observable<AnyEventEmission<EventContract>> {
    if (!Object.prototype.hasOwnProperty.call(this.contracts, eventName)) {
      throw new Error(`Contract not found for event: ${eventName}`);
    }

    return this.subscribeAny$(eventName);
  }

  /**
   * Subscribe to an event
   * 
   * @param eventName - Name of the event to subscribe to
   * @param input - Input parameters for the event (validated against contract)
   * @returns Async iterator yielding event data
   */
  subscribe<K extends keyof TContracts>(
    eventName: K,
    input: EventInput<TContracts[K]>,
    options?: ReplayOptions,
  ): EventSubscription<TContracts[K]> {
    const stream$ = this.subscribe$(eventName, input, options);
    return observableToAsyncIterable(stream$)[Symbol.asyncIterator]() as EventSubscription<TContracts[K]>;
  }

  queryByInput$<K extends keyof TContracts>(
    eventName: K,
    options?: QueryByInputOptions<EventInput<TContracts[K]>>,
  ): Observable<AnyEventEmission<TContracts[K]>> {
    const contract = this.contracts[eventName];
    if (!contract) {
      throw new Error(`Contract not found for event: ${String(eventName)}`);
    }

    const replayLimit = options?.replayLimit ?? this.durableReplayLimit;
    const includePersisted = options?.includePersisted ?? true;

    return new Observable<AnyEventEmission<TContracts[K]>>((subscriber) => {
      void (async () => {
        try {
          if (includePersisted && BaseEventService.persistenceAdapter) {
            const persisted = await BaseEventService.persistenceAdapter.findRecentByEventName({
              namespace: this.eventPrefix,
              eventName: String(eventName),
              limit: replayLimit,
            });

            for (const item of persisted) {
              const parsedInput = contract.input.parse(item.input) as EventInput<TContracts[K]>;
              if (!this.matchesInput(parsedInput, options)) {
                continue;
              }
              subscriber.next({
                input: parsedInput,
                output: item.output as EventOutput<TContracts[K]>,
              });
            }
          }

          const buffered = this.durableEmissionsByEventName.get(String(eventName)) ?? [];
          for (const item of buffered.slice(-replayLimit)) {
            const parsedInput = contract.input.parse(item.input) as EventInput<TContracts[K]>;
            if (!this.matchesInput(parsedInput, options)) {
              continue;
            }
            subscriber.next({
              input: parsedInput,
              output: item.output as EventOutput<TContracts[K]>,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Skipping persisted query replay for '${String(eventName)}': ${message}`);
        }
      })();

      const subscription = this.subscribeAny$(eventName).subscribe((event) => {
        if (!this.matchesInput(event.input, options)) {
          return;
        }
        subscriber.next(event);
      });

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  /**
   * Emit an event
   * 
   * @param eventName - Name of the event to emit
   * @param input - Input parameters for the event (used to build event name)
   * @param output - Event data to emit (validated against contract)
   */
  emit<K extends keyof TContracts>(
    eventName: K,
    input: EventInput<TContracts[K]>,
    output: EventOutput<TContracts[K]>
  ): void {
    const contract = this.contracts[eventName];
    if (!contract) {
      throw new Error(`Contract not found for event: ${String(eventName)}`);
    }

    // Validate input and output
    const validatedInput = contract.input.parse(input) as EventInput<TContracts[K]>;
    const validatedOutput = contract.output.parse(output) as EventOutput<TContracts[K]>;

    // Build full event name using fileId from input
    const fullEventName = this.buildFullEventName(String(eventName), validatedInput);
    const sequence = (this.sequenceByEventKey.get(fullEventName) ?? 0) + 1;
    this.sequenceByEventKey.set(fullEventName, sequence);

    const bufferedRecord: BufferedEventRecord = {
      eventName: String(eventName),
      eventKey: fullEventName,
      input: validatedInput,
      output: validatedOutput,
      sequence,
      emittedAt: new Date().toISOString(),
    };

    this.appendBufferedRecord(this.durableEmissionsByKey, fullEventName, bufferedRecord);
    this.appendBufferedRecord(this.durableEmissionsByEventName, String(eventName), bufferedRecord);

    this.pendingPersistence.push({
      namespace: this.eventPrefix,
      eventName: String(eventName),
      eventKey: fullEventName,
      sequence,
      input: bufferedRecord.input,
      output: bufferedRecord.output,
      emittedAt: new Date(bufferedRecord.emittedAt),
    });

    if (this.pendingPersistence.length >= this.pendingFlushBatchSize) {
      void this.flushPendingToPersistence();
    }

    const subscription = this.events.get(fullEventName);
    if (subscription) {
      const typedSubject = subscription.subject as Subject<EventOutput<TContracts[K]>>;
      typedSubject.next(validatedOutput);
    }

    const anySubscription = this.anyEventSubscriptions.get(String(eventName));
    if (anySubscription) {
      const anyTypedSubject = anySubscription.subject as Subject<AnyEventEmission<TContracts[K]>>;
      anyTypedSubject.next({
        input: validatedInput,
        output: validatedOutput,
      });
    }
  }

  /**
   * Start a processing operation and expose an emit bridge tied to the event input.
   */
  async startProcessing<K extends keyof TContracts>(
    eventName: K,
    input: EventInput<TContracts[K]>,
    handler: (params: {
      abortSignal?: AbortSignal;
      input: EventInput<TContracts[K]>;
      emit: (output: EventOutput<TContracts[K]>) => void;
    }) => void | Promise<void>
  ): Promise<void> {
    const contract = this.contracts[eventName];
    if (!contract) {
      throw new Error(`Contract not found for event: ${String(eventName)}`);
    }
    const validatedInput = contract.input.parse(input) as EventInput<TContracts[K]>;

    const emit = (output: EventOutput<TContracts[K]>): void => {
      this.emit(eventName, validatedInput, output);
    };

    await Promise.resolve(handler({ input: validatedInput, emit }));
  }

  /**
   * Check if an event has active subscribers
   * 
   * @param eventName - Name of the event to check
   * @param input - Input parameters for the event
   */
  hasSubscribers<K extends keyof TContracts>(
    eventName: K,
    input: EventInput<TContracts[K]>
  ): boolean {
    const contract = this.contracts[eventName];
    if (!contract) {
      throw new Error(`Contract not found for event: ${String(eventName)}`);
    }
    const validatedInput = contract.input.parse(input) as EventInput<TContracts[K]>;
    const fullEventName = this.buildFullEventName(String(eventName), validatedInput);

    const subscription = this.events.get(fullEventName);
    return subscription ? subscription.subscriberCount > 0 : false;
  }

  /**
   * Get subscriber count for an event
   * 
   * @param eventName - Name of the event to check
   * @param input - Input parameters for the event
   */
  getSubscriberCount<K extends keyof TContracts>(
    eventName: K,
    input: EventInput<TContracts[K]>
  ): number {
    const contract = this.contracts[eventName];
    if (!contract) {
      throw new Error(`Contract not found for event: ${String(eventName)}`);
    }
    const validatedInput = contract.input.parse(input) as EventInput<TContracts[K]>;
    const fullEventName = this.buildFullEventName(String(eventName), validatedInput);

    const subscription = this.events.get(fullEventName);
    return subscription ? subscription.subscriberCount : 0;
  }

  /**
   * Check if an event is currently processing
   * 
   * @param eventName - Name of the event to check
   * @param input - Input parameters for the event
   */
  isProcessing<K extends keyof TContracts>(
    eventName: K,
    input: EventInput<TContracts[K]>
  ): boolean {
    const contract = this.contracts[eventName];
    if (!contract) {
      throw new Error(`Contract not found for event: ${String(eventName)}`);
    }
    contract.input.parse(input);
    return false;
  }

  /**
   * Get queue length for an event
   * 
   * @param eventName - Name of the event to check
   * @param input - Input parameters for the event
   */
  getQueueLength<K extends keyof TContracts>(
    eventName: K,
    input: EventInput<TContracts[K]>
  ): number {
    const contract = this.contracts[eventName];
    if (!contract) {
      throw new Error(`Contract not found for event: ${String(eventName)}`);
    }
    contract.input.parse(input);
    return 0;
  }

  /**
   * Build full event name from prefix, event name, and input
   * Override this method to customize event naming strategy
   * 
   * @param eventName - Base event name
   * @param input - Validated input data
   */
  protected buildFullEventName(
    eventName: string,
    input: Record<string, unknown>
  ): string {
    // Default implementation: prefix:eventName:firstInputValue
    const firstValue = Object.values(input)[0];
    return `${this.eventPrefix}:${eventName}:${String(firstValue)}`;
  }

  /**
   * Remove all subscribers for an event (cleanup utility)
   * 
   * @param eventName - Name of the event to clear
   * @param input - Input parameters for the event
   */
  removeAllSubscribers<K extends keyof TContracts>(
    eventName: K,
    input: EventInput<TContracts[K]>
  ): void {
    const contract = this.contracts[eventName];
    if (!contract) {
      throw new Error(`Contract not found for event: ${String(eventName)}`);
    }
    const validatedInput = contract.input.parse(input) as EventInput<TContracts[K]>;
    const fullEventName = this.buildFullEventName(String(eventName), validatedInput);

    const subscription = this.events.get(fullEventName);
    if (subscription) {
      subscription.subject.complete();
      this.events.delete(fullEventName);
    }
  }

  /**
   * Get all active event names
   */
  getActiveEvents(): string[] {
    return Array.from(this.events.keys());
  }

  /**
   * Clear all events and subscriptions
   */
  clearAll(): void {
    // Clear all subscriptions
    for (const subscription of this.events.values()) {
      subscription.subject.complete();
    }
    this.events.clear();

    for (const subscription of this.anyEventSubscriptions.values()) {
      subscription.subject.complete();
    }
    this.anyEventSubscriptions.clear();
    this.durableEmissionsByKey.clear();
    this.durableEmissionsByEventName.clear();
    this.sequenceByEventKey.clear();
    this.pendingPersistence.length = 0;

    this.logger.log('All events cleared');
  }

  protected buildInputReplayFuzzy<TInput extends Record<string, unknown>>(input: TInput): string {
    return JSON.stringify(input).toLowerCase();
  }

  /**
   * Returns the highest sequence number buffered for the given event key.
   * Callers use this as the cursor value to pass back on reconnect via `afterSequence`.
   */
  getLastSequence<K extends keyof TContracts>(
    eventName: K,
    input: EventInput<TContracts[K]>,
  ): number {
    const contract = this.contracts[eventName];
    if (!contract) {
      return 0;
    }
    const validatedInput = contract.input.parse(input) as EventInput<TContracts[K]>;
    const fullEventName = this.buildFullEventName(String(eventName), validatedInput);
    return this.sequenceByEventKey.get(fullEventName) ?? 0;
  }

  private appendBufferedRecord(
    target: Map<string, BufferedEventRecord[]>,
    key: string,
    record: BufferedEventRecord,
  ): void {
    const previous = target.get(key) ?? [];
    const appended = [...previous, record];
    const overflow = appended.length - this.durableReplayLimit;
    target.set(key, overflow > 0 ? appended.slice(overflow) : appended);
  }

  private matchesInput<TInput extends Record<string, unknown>>(
    input: TInput,
    options?: QueryByInputOptions<TInput>,
  ): boolean {
    if (options?.predicate && !options.predicate(input)) {
      return false;
    }

    if (options?.fuzzy) {
      const haystack = this.buildInputReplayFuzzy(input);
      return haystack.includes(options.fuzzy.trim().toLowerCase());
    }

    return true;
  }

  private async flushPendingToPersistence(): Promise<void> {
    if (this.isFlushing || this.pendingPersistence.length === 0 || !BaseEventService.persistenceAdapter) {
      return;
    }

    this.isFlushing = true;
    try {
      const batch = this.pendingPersistence.splice(0, this.pendingFlushBatchSize);
      await BaseEventService.persistenceAdapter.insertMany(batch);
    } catch (error) {
      this.logger.error('Failed to persist event logs', error as Error);
    } finally {
      this.isFlushing = false;
    }
  }

  private readonly flushTicker = this.startFlushTicker();

  private startFlushTicker(): ReturnType<typeof setInterval> {
    const timer = setInterval(() => {
      void this.flushPendingToPersistence();
    }, this.flushIntervalMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    return timer;
  }

  /**
   * NestJS lifecycle hook — clears the persistent flush ticker so the
   * process can exit cleanly. All concrete event services inherit this
   * behaviour automatically. If a subclass needs to perform additional
   * teardown, it must override and call `super.onModuleDestroy()`.
   */
  onModuleDestroy(): void {
    this.stopFlushTicker();
  }

  protected stopFlushTicker(): void {
    if (this.flushTicker) {
      clearInterval(this.flushTicker);
    }
  }
}

interface MergeSelection {
  service: BaseEventService;
  eventNames: Set<string> | null;
}

export interface MergeRegisteredOptions {
  namespaces?: string[];
  referenceScopes?: string[];
}

export class BaseEventMergeBuilder {
  private readonly selections = new Map<string, MergeSelection>();
  private readonly predicates: ((event: MergedDomainEventEnvelope) => boolean)[] = [];
  private activeSelectionKeys: string[] = [];

  fromService(service: BaseEventService): this {
    if (!BaseEventService.hasBaseEventSymbol(service)) {
      throw new Error('Service does not extend BaseEventService symbol contract');
    }

    const selectionKey = this.buildSelectionKey(service);
    const existing = this.selections.get(selectionKey);

    this.selections.set(selectionKey, {
      service,
      eventNames: existing?.eventNames ?? null,
    });

    this.activeSelectionKeys = [selectionKey];
    return this;
  }

  fromServices(services: readonly BaseEventService[]): this {
    const keys: string[] = [];

    for (const service of services) {
      if (!BaseEventService.hasBaseEventSymbol(service)) {
        continue;
      }

      const selectionKey = this.buildSelectionKey(service);
      const existing = this.selections.get(selectionKey);

      this.selections.set(selectionKey, {
        service,
        eventNames: existing?.eventNames ?? null,
      });

      keys.push(selectionKey);
    }

    this.activeSelectionKeys = keys;
    return this;
  }

  fromNamespace(namespace: string): this {
    return this.fromServices(BaseEventService.findRegisteredByNamespace(namespace));
  }

  fromReferenceScope(referenceScope: string): this {
    return this.fromServices(BaseEventService.findRegisteredByReferenceScope(referenceScope));
  }

  fromRegistered(options?: MergeRegisteredOptions): this {
    const namespaces = options?.namespaces ? new Set(options.namespaces) : null;
    const referenceScopes = options?.referenceScopes ? new Set(options.referenceScopes) : null;

    const services = BaseEventService.listRegisteredServices().filter((service) => {
      const namespaceMatch = namespaces ? namespaces.has(service.namespace) : true;
      const referenceScopeMatch = referenceScopes ? referenceScopes.has(service.referenceScope) : true;
      return namespaceMatch && referenceScopeMatch;
    });

    return this.fromServices(services);
  }

  events(...eventNames: string[]): this {
    const normalized = eventNames
      .map((eventName) => eventName.trim())
      .filter((eventName) => eventName.length > 0);

    if (normalized.length === 0) {
      return this;
    }

    const selectionKeys = this.resolveSelectionKeys();
    for (const key of selectionKeys) {
      const selection = this.selections.get(key);
      if (!selection) {
        continue;
      }

      const current = selection.eventNames ?? new Set<string>();
      for (const eventName of normalized) {
        current.add(eventName);
      }

      selection.eventNames = current;
      this.selections.set(key, selection);
    }

    return this;
  }

  allEvents(): this {
    const selectionKeys = this.resolveSelectionKeys();
    for (const key of selectionKeys) {
      const selection = this.selections.get(key);
      if (!selection) {
        continue;
      }

      selection.eventNames = null;
      this.selections.set(key, selection);
    }

    return this;
  }

  where(predicate: (event: MergedDomainEventEnvelope) => boolean): this {
    this.predicates.push(predicate);
    return this;
  }

  toObservable(): Observable<MergedDomainEventEnvelope> {
    const streams: Observable<MergedDomainEventEnvelope>[] = [];

    for (const selection of this.selections.values()) {
      const eventNames = selection.eventNames
        ? Array.from(selection.eventNames)
        : selection.service.getContractNames();

      for (const eventName of eventNames) {
        streams.push(
          selection.service.observeAnyByName$(eventName).pipe(
            map((event) => ({
              namespace: selection.service.namespace,
              domainServiceName: selection.service.domainServiceName,
              referenceScope: selection.service.referenceScope,
              eventName,
              input: isRecord(event.input) ? event.input : {},
              output: event.output,
              emittedAt: new Date().toISOString(),
            })),
          ),
        );
      }
    }

    if (streams.length === 0) {
      return EMPTY;
    }

    let merged$ = merge(...streams);
    for (const predicate of this.predicates) {
      merged$ = merged$.pipe(rxFilter(predicate));
    }

    return merged$;
  }

  toAsyncIterable(): AsyncIterableIterator<MergedDomainEventEnvelope> {
    return observableToAsyncIterable(this.toObservable())[Symbol.asyncIterator]() as AsyncIterableIterator<MergedDomainEventEnvelope>;
  }

  private resolveSelectionKeys(): string[] {
    if (this.activeSelectionKeys.length > 0) {
      return this.activeSelectionKeys;
    }

    return Array.from(this.selections.keys());
  }

  private buildSelectionKey(service: BaseEventService): string {
    return `${service.namespace}:${service.referenceScope}`;
  }
}
