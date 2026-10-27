/**
 * @deployer/nest-events — NestJS + RxJS typed event system with Zod validation
 *
 * ⚠️ Value exports only (classes, functions, consts) — these have runtime bindings.
 * Type-only exports (interfaces, type aliases) use separate `export type` blocks
 * to avoid Bun ESM runtime resolution errors.
 */

// ── Value exports (runtime-safe) ───────────────────────────────────────────
export {
  BaseEventService,
  BASE_EVENT_SERVICE_SYMBOL,
} from '@deployer/nest-events/base-event.service';

export {
  EventContractBuilder,
  contractBuilder,
} from '@deployer/nest-events/event-contract.builder';

export {
  BasePooledEventService,
} from '@deployer/nest-events/base-pooled-event.service';

export {
  CoreEventStreamPoolService,
} from '@deployer/nest-events/core-event-stream-pool.service';

export {
  AbstractDomainEventStreamService,
  BASE_DOMAIN_STREAM_SERVICE_SYMBOL,
} from '@deployer/nest-events/abstract-domain-event-stream.service';

export { observableToAsyncIterable } from '@deployer/nest-events/observable.utils';

// The generic storage-level classifier. The platform's own boot-sequence rule
// (`DatabaseNotReadyReporter`) lives in `apps/api` — shared packages export core
// functionality, not business logic.
export { isTransientDatabaseError } from '@deployer/nest-events/db-not-ready';

// ── Type-only exports (interfaces/type aliases consumed by the API) ────────
export type {
  EventContract,
  EventContracts,
  EventInput,
  EventOutput,
} from '@deployer/nest-events/event-contract.builder';

export type {
  EventSubscription,
  AnyEventEmission,
} from '@deployer/nest-events/base-event.service';
