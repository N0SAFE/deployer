/**
 * Events Module — Public API
 *
 * The RxJS event services (`./base`), and the repositories, outbox and sync service that depend on
 * API-specific Drizzle schemas.
 */

export * from './events.module'

export {
    BaseEventService,
    BASE_EVENT_SERVICE_SYMBOL,
    BasePooledEventService,
    AbstractDomainEventStreamService,
    CoreEventStreamPoolService,
    observableToAsyncIterable,
} from './base/index'
export { EventContractBuilder, contractBuilder } from '@deployer/events'
export type {
    EventContract,
    EventContracts,
    EventInput,
    EventOutput,
} from '@deployer/events'

// Local files (stay in API due to DB schema coupling)
export * from './services/core-event-sync.service'
export * from './repositories/core-event-stream.repository'
export * from './outbox/local-event-outbox-dispatcher.service'
