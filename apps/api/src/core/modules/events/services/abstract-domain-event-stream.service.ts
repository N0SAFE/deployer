import type { Observable } from "rxjs";
import { EMPTY, merge } from "rxjs";
import { filter as rxFilter } from "rxjs/operators";
import type {
  CoreEventStreamPoolService} from "./core-event-stream-pool.service";
import {
  type ObservePooledStreamOptions,
} from "./core-event-stream-pool.service";

export const BASE_DOMAIN_STREAM_SERVICE_SYMBOL = Symbol.for("core.events.domain-stream-service");

export interface BaseDomainStreamServiceSymbolized {
  readonly [BASE_DOMAIN_STREAM_SERVICE_SYMBOL]: true;
}

export interface DomainStreamServiceRegistryEntry {
  streamDomain: string;
  domainServiceName: string;
  referenceScope: string;
  service: AbstractDomainEventStreamService;
}

export interface DomainStreamMergeRegisteredOptions {
  domains?: string[];
  referenceScopes?: string[];
}

export abstract class AbstractDomainEventStreamService {
  private static readonly serviceRegistry = new Set<AbstractDomainEventStreamService>();

  protected abstract readonly streamDomain: string;
  readonly [BASE_DOMAIN_STREAM_SERVICE_SYMBOL] = true as const;

  constructor(protected readonly streamPool: CoreEventStreamPoolService) {
    AbstractDomainEventStreamService.registerInstance(this);
  }

  get domainServiceName(): string {
    return this.constructor.name;
  }

  get referenceScope(): string {
    return this.domainServiceName;
  }

  get domainNamespace(): string {
    return this.streamDomain;
  }

  static hasBaseDomainStreamSymbol(value: unknown): value is BaseDomainStreamServiceSymbolized {
    return (
      typeof value === "object" &&
      value !== null &&
      BASE_DOMAIN_STREAM_SERVICE_SYMBOL in value &&
      (value as Record<symbol, unknown>)[BASE_DOMAIN_STREAM_SERVICE_SYMBOL] === true
    );
  }

  static listRegisteredServices(): AbstractDomainEventStreamService[] {
    return Array.from(AbstractDomainEventStreamService.serviceRegistry);
  }

  static listRegisteredServiceEntries(): DomainStreamServiceRegistryEntry[] {
    return AbstractDomainEventStreamService.listRegisteredServices().map((service) => ({
      streamDomain: service.domainNamespace,
      domainServiceName: service.domainServiceName,
      referenceScope: service.referenceScope,
      service,
    }));
  }

  static findRegisteredByDomain(streamDomain: string): AbstractDomainEventStreamService[] {
    return AbstractDomainEventStreamService.listRegisteredServices().filter(
      (service) => service.domainNamespace === streamDomain,
    );
  }

  static findRegisteredByReferenceScope(referenceScope: string): AbstractDomainEventStreamService[] {
    return AbstractDomainEventStreamService.listRegisteredServices().filter(
      (service) => service.referenceScope === referenceScope,
    );
  }

  static mergeBuilder<TValue>(): DomainStreamMergeBuilder<TValue> {
    return new DomainStreamMergeBuilder<TValue>().fromRegistered();
  }

  static clearRegistryForTests(): void {
    AbstractDomainEventStreamService.serviceRegistry.clear();
  }

  protected observeDomainPooledStream<T>(
    streamKey: string,
    streamFactory: () => Observable<T>,
    options?: Omit<ObservePooledStreamOptions, "onError">,
  ): Observable<T> {
    return this.streamPool.observePooledStream(
      this.buildDomainStreamKey(streamKey),
      streamFactory,
      {
        ...options,
        onError: (error) => this.formatStreamError(error),
      },
    );
  }

  protected buildDomainStreamKey(streamKey: string): string {
    return `${this.streamDomain}:${streamKey}`;
  }

  protected formatStreamError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private static registerInstance(instance: AbstractDomainEventStreamService): void {
    AbstractDomainEventStreamService.serviceRegistry.add(instance);
  }
}

interface DomainStreamSelection {
  service: AbstractDomainEventStreamService;
}

export class DomainStreamMergeBuilder<TValue> {
  private readonly selections = new Map<string, DomainStreamSelection>();
  private readonly predicates: ((value: TValue) => boolean)[] = [];
  private activeSelectionKeys: string[] = [];
  private streamFactory: ((service: AbstractDomainEventStreamService) => Observable<TValue>) | null = null;

  fromService(service: AbstractDomainEventStreamService): this {
    if (!AbstractDomainEventStreamService.hasBaseDomainStreamSymbol(service)) {
      throw new Error("Service does not extend AbstractDomainEventStreamService symbol contract");
    }

    const key = this.buildSelectionKey(service);
    this.selections.set(key, { service });
    this.activeSelectionKeys = [key];
    return this;
  }

  fromServices(services: readonly AbstractDomainEventStreamService[]): this {
    const keys: string[] = [];

    for (const service of services) {
      if (!AbstractDomainEventStreamService.hasBaseDomainStreamSymbol(service)) {
        continue;
      }

      const key = this.buildSelectionKey(service);
      this.selections.set(key, { service });
      keys.push(key);
    }

    this.activeSelectionKeys = keys;
    return this;
  }

  fromDomain(streamDomain: string): this {
    return this.fromServices(AbstractDomainEventStreamService.findRegisteredByDomain(streamDomain));
  }

  fromReferenceScope(referenceScope: string): this {
    return this.fromServices(AbstractDomainEventStreamService.findRegisteredByReferenceScope(referenceScope));
  }

  fromRegistered(options?: DomainStreamMergeRegisteredOptions): this {
    const domains = options?.domains ? new Set(options.domains) : null;
    const referenceScopes = options?.referenceScopes ? new Set(options.referenceScopes) : null;

    const services = AbstractDomainEventStreamService.listRegisteredServices().filter((service) => {
      const domainMatch = domains ? domains.has(service.domainNamespace) : true;
      const referenceMatch = referenceScopes ? referenceScopes.has(service.referenceScope) : true;
      return domainMatch && referenceMatch;
    });

    return this.fromServices(services);
  }

  usingFactory(factory: (service: AbstractDomainEventStreamService) => Observable<TValue>): this {
    this.streamFactory = factory;
    return this;
  }

  where(predicate: (value: TValue) => boolean): this {
    this.predicates.push(predicate);
    return this;
  }

  toObservable(): Observable<TValue> {
    if (!this.streamFactory) {
      throw new Error("Merge builder requires .usingFactory(...) before .toObservable()");
    }

    const selectionKeys = this.resolveSelectionKeys();
    const streams: Observable<TValue>[] = [];

    for (const key of selectionKeys) {
      const selection = this.selections.get(key);
      if (!selection) {
        continue;
      }

      streams.push(this.streamFactory(selection.service));
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

  private resolveSelectionKeys(): string[] {
    if (this.activeSelectionKeys.length > 0) {
      return this.activeSelectionKeys;
    }

    return Array.from(this.selections.keys());
  }

  private buildSelectionKey(service: AbstractDomainEventStreamService): string {
    return `${service.domainNamespace}:${service.referenceScope}`;
  }
}