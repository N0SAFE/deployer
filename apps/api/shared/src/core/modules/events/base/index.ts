/**
 * The Nest host for `@deployer/events`: the RxJS services that stream domain events. Durability
 * (sequences, replay buffers, the retrying persistence queue) is the Effect package's `EventJournal`;
 * contracts come from `@deployer/events`.
 */
export { BaseEventService, BASE_EVENT_SERVICE_SYMBOL } from "./base-event.service";
export type { AnyEventEmission, EventSubscription } from "./base-event.service";
export { BasePooledEventService } from "./base-pooled-event.service";
export {
  CoreEventStreamPoolService,
  makeCoreEventStreamPoolService,
  type CoreEventStreamPoolServiceShape,
} from "./core-event-stream-pool.service";
export { AbstractDomainEventStreamService, BASE_DOMAIN_STREAM_SERVICE_SYMBOL } from "./abstract-domain-event-stream.service";
export { observableToAsyncIterable } from "./observable.utils";
