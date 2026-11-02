import { Injectable } from '@nestjs/common';

import { createGlobalModule } from '@deployer/nest-effect';

import { DatabaseModule } from '../database/database.module';

import { BaseEventService, CoreEventStreamPoolService } from './base/index';
import { LocalEventOutboxDispatcherService } from './outbox/local-event-outbox-dispatcher.service';
import { LocalEventOutboxRepository } from './outbox/local-event-outbox.repository';
import { CoreEventLogRepository } from './repositories/core-event-log.repository';
import { CoreEventStreamRepository } from './repositories/core-event-stream.repository';
import { CoreEventSyncService } from './services/core-event-sync.service';

/**
 * Binds `BaseEventService` to the log repository this module provides.
 *
 * The module class used to do this in its constructor; `createModuleContext` builds a bare class, so the wiring is a
 * provider instead — Nest instantiates every provider at bootstrap, which is the same point in the boot sequence.
 */
@Injectable()
class EventsPersistenceWiring {
  constructor(coreEventLogRepository: CoreEventLogRepository) {
    BaseEventService.configurePersistenceAdapter(coreEventLogRepository);
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
    CoreEventLogRepository,
    CoreEventStreamRepository,
    LocalEventOutboxRepository,
    CoreEventStreamPoolService,
    CoreEventSyncService,
    LocalEventOutboxDispatcherService,
    // Was the module class's own constructor; a module built by `createModuleContext` has none, and Nest
    // instantiates every provider at bootstrap, so the adapter is bound at the same point in boot.
    EventsPersistenceWiring,
  ],
  exports: [
    CoreEventLogRepository,
    CoreEventStreamRepository,
    LocalEventOutboxRepository,
    CoreEventStreamPoolService,
    CoreEventSyncService,
    LocalEventOutboxDispatcherService,
  ],
});
