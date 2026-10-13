/**
 * Events Module — Public API
 *
 * Re-exports from @deployer/nest-events (shared) and local files (repositories,
 * outbox, sync service that depend on API-specific Drizzle schemas).
 */

export * from '@/core/modules/events/events.module';

// Moved to @deployer/nest-events — re-exported for backward compat
export {
  BaseEventService,
  BASE_EVENT_SERVICE_SYMBOL,
  EventContractBuilder,
  contractBuilder,
  BasePooledEventService,
  AbstractDomainEventStreamService,
  CoreEventStreamPoolService,
  observableToAsyncIterable,
} from '@deployer/nest-events';
export type {
  EventContract,
  EventContracts,
  EventInput,
  EventOutput,
} from '@deployer/nest-events';

// Local files (stay in API due to DB schema coupling)
export * from '@/core/modules/events/services/core-event-sync.service';
export * from '@/core/modules/events/repositories/core-event-stream.repository';
export * from '@/core/modules/events/outbox/local-event-outbox-dispatcher.service';
