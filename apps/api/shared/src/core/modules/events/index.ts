/**
 * Events Module — Public API
 *
 * Re-exports from @repo/nest-events (shared) and local files (repositories,
 * outbox, sync service that depend on API-specific Drizzle schemas).
 */

export * from './events.module';

// Moved to @repo/nest-events — re-exported for backward compat
export {
  BaseEventService,
  BASE_EVENT_SERVICE_SYMBOL,
  EventContractBuilder,
  contractBuilder,
  BasePooledEventService,
  AbstractDomainEventStreamService,
  CoreEventStreamPoolService,
  observableToAsyncIterable,
} from '@repo/nest-events';
export type {
  EventContract,
  EventContracts,
  EventInput,
  EventOutput,
} from '@repo/nest-events';

// Local files (stay in API due to DB schema coupling)
export * from './services/core-event-sync.service';
export * from './repositories/core-event-stream.repository';
export * from './outbox/local-event-outbox-dispatcher.service';
