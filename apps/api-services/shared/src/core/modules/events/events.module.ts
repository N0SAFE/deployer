import { Module, Global } from '@nestjs/common';
import { DatabaseModule } from '@/core/modules/database/database.module';
import { BaseEventService, CoreEventStreamPoolService } from '@deployer/nest-events';
import { CoreEventLogRepository } from '@/core/modules/events/repositories/core-event-log.repository';
import { CoreEventStreamRepository } from '@/core/modules/events/repositories/core-event-stream.repository';
import { CoreEventSyncService } from '@/core/modules/events/services/core-event-sync.service';
import { LocalEventOutboxRepository } from '@/core/modules/events/outbox/local-event-outbox.repository';
import { LocalEventOutboxDispatcherService } from '@/core/modules/events/outbox/local-event-outbox-dispatcher.service';

/**
 * Global Events Module
 *
 * This module provides the base event infrastructure.
 * Feature-specific event services should be registered in their respective modules.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    CoreEventLogRepository,
    CoreEventStreamRepository,
    LocalEventOutboxRepository,
    CoreEventStreamPoolService,
    CoreEventSyncService,
    LocalEventOutboxDispatcherService,
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
export class EventsModule {
  constructor(coreEventLogRepository: CoreEventLogRepository) {
    BaseEventService.configurePersistenceAdapter(coreEventLogRepository);
  }
}
