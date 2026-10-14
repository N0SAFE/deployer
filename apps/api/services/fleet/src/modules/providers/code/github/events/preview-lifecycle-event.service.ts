import { Injectable } from "@nestjs/common";
import { BasePooledEventService } from "@repo/nest-events";
import {
    previewLifecycleEventContracts,
    type PreviewLifecycleEventContracts,
} from "./preview-lifecycle-event.contracts";
import { CoreEventStreamPoolService } from "@repo/nest-events";

// T037: Preview lifecycle audit trail event service.
@Injectable()
export class PreviewLifecycleEventService extends BasePooledEventService<PreviewLifecycleEventContracts> {
    constructor(streamPool?: CoreEventStreamPoolService) {
        super("preview", previewLifecycleEventContracts, streamPool);
    }
}
