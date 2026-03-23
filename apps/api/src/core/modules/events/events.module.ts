import { Module, Global } from '@nestjs/common';
import { DatabaseModule } from '@/core/modules/database/database.module';
import { BaseEventService } from './base-event.service';
import { CoreEventLogRepository } from './repositories/core-event-log.repository';
import { CoreEventStreamRepository } from './repositories/core-event-stream.repository';
import { CoreEventSyncService } from './services/core-event-sync.service';
import { LocalEventOutboxDispatcherService } from './outbox/local-event-outbox-dispatcher.service';

/**
 * Global Events Module
 * 
 * This module provides the base event infrastructure.
 * Feature-specific event services should be registered in their respective modules.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [CoreEventLogRepository, CoreEventStreamRepository, CoreEventSyncService, LocalEventOutboxDispatcherService],
  exports: [CoreEventLogRepository, CoreEventStreamRepository, CoreEventSyncService, LocalEventOutboxDispatcherService],
})
export class EventsModule {
  constructor(coreEventLogRepository: CoreEventLogRepository) {
    BaseEventService.configurePersistenceAdapter(coreEventLogRepository);
  }
}
