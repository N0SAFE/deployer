import { Effect } from 'effect'

import { EventLogUnavailable, type EventLogStoreShape } from '@deployer/events'
import { AppLifecycle, type AppLifecycleShape } from '@deployer/lifecycle'
import {
    createGlobalModule,
    EffectHost,
    effectHostProvider,
    serviceLifecycle,
    ServiceLifecycleRunner,
    type EffectHostShape,
} from '@deployer/nest-effect'

import { DatabaseModule } from '../database/database.module'
import { DatabasePort } from '../database/storage'

import {
    BaseEventService,
    CoreEventStreamPoolService,
    makeCoreEventStreamPoolService,
} from './base/index'
import {
    LocalEventOutboxDispatcherService,
} from './outbox/local-event-outbox-dispatcher.service'
import {
    LocalEventOutboxRepository,
    makeLocalEventOutboxRepository,
    type LocalEventOutboxRepositoryShape,
} from './outbox/local-event-outbox.repository'
import {
    CoreEventLogRepository,
    makeCoreEventLogRepository,
    type CoreEventLogRepositoryShape,
} from './repositories/core-event-log.repository'
import {
    CoreEventStreamRepository,
    makeCoreEventStreamRepository,
    type CoreEventStreamRepositoryShape,
} from './repositories/core-event-stream.repository'
import {
    CoreEventSyncService,
    makeCoreEventSyncService,
} from './services/core-event-sync.service'

import type { CoreEventStreamPoolServiceShape } from './base/index'
import type { Context } from 'effect'

/** The log repository as the journal's Effect store: a failure becomes an `EventLogUnavailable` carrying the original error. */
const asEventLogStore = (
    repository: CoreEventLogRepositoryShape
): EventLogStoreShape => {
    const unavailable = (failure: {
        readonly message: string
        readonly cause?: unknown
    }) =>
        new EventLogUnavailable({
            reason: failure.message,
            cause: failure.cause ?? failure,
        })
    return {
        insertMany: (logs) =>
            Effect.mapError(repository.insertMany([...logs]), unavailable),
        findRecentByEventKey: (query) =>
            Effect.mapError(
                repository.findRecentByEventKey(query),
                unavailable
            ),
        findRecentByEventName: (query) =>
            Effect.mapError(
                repository.findRecentByEventName(query),
                unavailable
            ),
    }
}

/**
 * Global Events Module
 *
 * This module provides the base event infrastructure.
 * Feature-specific event services should be registered in their respective modules.
 */
export const EventsModule = createGlobalModule({
    imports: [DatabaseModule],
    providers: [
        effectHostProvider(),
        {
            provide: CoreEventLogRepository,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => makeCoreEventLogRepository(database),
            inject: [DatabasePort],
        },
        {
            provide: CoreEventStreamRepository,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => makeCoreEventStreamRepository(database),
            inject: [DatabasePort],
        },
        {
            provide: LocalEventOutboxRepository,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => makeLocalEventOutboxRepository(database),
            inject: [DatabasePort],
        },
        {
            provide: CoreEventStreamPoolService,
            useFactory: () => makeCoreEventStreamPoolService(),
        },
        {
            provide: CoreEventSyncService,
            useFactory: (
                repository: CoreEventStreamRepositoryShape,
                streamPool: CoreEventStreamPoolServiceShape
            ) => makeCoreEventSyncService({ repository, streamPool }),
            inject: [CoreEventStreamRepository, CoreEventStreamPoolService],
        },
        {
            provide: LocalEventOutboxDispatcherService,
            useFactory: (
                outbox: LocalEventOutboxRepositoryShape,
                lifecycle: AppLifecycleShape
            ) => new LocalEventOutboxDispatcherService.live(outbox, lifecycle),
            inject: [LocalEventOutboxRepository, AppLifecycle],
        },
        serviceLifecycle(LocalEventOutboxDispatcherService),
        {
            // Binds every event service to the log repository (was the module class's own constructor) — a provider is built at
            // bootstrap, the same point in boot — and stops them all at shutdown.
            provide: Symbol.for('shared/EventServicesLifecycle'),
            useFactory: (
                repository: CoreEventLogRepositoryShape,
                host: EffectHostShape
            ) => {
                BaseEventService.configureEventLogStore(
                    asEventLogStore(repository)
                )
                return new ServiceLifecycleRunner(
                    'EventServices',
                    {
                        onStop: () =>
                            Effect.sync(() => {
                                BaseEventService.disposeAll()
                            }),
                    },
                    host
                )
            },
            inject: [CoreEventLogRepository, EffectHost],
        },
    ],
    exports: [
        CoreEventLogRepository,
        CoreEventStreamRepository,
        LocalEventOutboxRepository,
        CoreEventStreamPoolService,
        CoreEventSyncService,
        LocalEventOutboxDispatcherService,
    ],
})
