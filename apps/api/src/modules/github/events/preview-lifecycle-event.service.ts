import { Injectable } from "@nestjs/common";
import { BasePooledEventService } from "@/core/modules/events/services/base-pooled-event.service";
import {
    previewLifecycleEventContracts,
    type PreviewLifecycleEventContracts,
} from "./preview-lifecycle-event.contracts";
import { CoreEventStreamPoolService } from "@/core/modules/events/services/core-event-stream-pool.service";

// T037: Preview lifecycle audit trail event service.
@Injectable()
export class PreviewLifecycleEventService extends BasePooledEventService<PreviewLifecycleEventContracts> {
    constructor(streamPool?: CoreEventStreamPoolService) {
        super("preview", previewLifecycleEventContracts, streamPool);
    }
}
