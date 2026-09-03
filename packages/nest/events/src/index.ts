/**
 * @repo/nest-events — NestJS + RxJS typed event system with Zod validation
 *
 * ⚠️ Value exports only (classes, functions, consts) — these have runtime bindings.
 * Type-only exports (interfaces, type aliases) use separate `export type` blocks
 * to avoid Bun ESM runtime resolution errors.
 */

// ── Value exports (runtime-safe) ───────────────────────────────────────────
export {
  BaseEventService,
  BASE_EVENT_SERVICE_SYMBOL,
} from './base-event.service';

export {
  EventContractBuilder,
  contractBuilder,
} from './event-contract.builder';

export {
  BasePooledEventService,
} from './base-pooled-event.service';

export {
  CoreEventStreamPoolService,
} from './core-event-stream-pool.service';

export {
  AbstractDomainEventStreamService,
  BASE_DOMAIN_STREAM_SERVICE_SYMBOL,
} from './abstract-domain-event-stream.service';

export { observableToAsyncIterable } from './observable.utils';

// ── Type-only exports (interfaces/type aliases consumed by the API) ────────
export type {
  EventContract,
  EventContracts,
  EventInput,
  EventOutput,
} from './event-contract.builder';

export type {
  EventSubscription,
  AnyEventEmission,
} from './base-event.service';
