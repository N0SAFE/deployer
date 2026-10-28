import { Injectable } from "@nestjs/common";
import { BasePooledEventService } from "@deployer/shared/core/modules/events/base/index";
import {
    previewLifecycleEventContracts,
    type PreviewLifecycleEventContracts,
} from "./preview-lifecycle-event.contracts";
import { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index";

// T037: Preview lifecycle audit trail event service.
@Injectable()
export class PreviewLifecycleEventService extends BasePooledEventService<PreviewLifecycleEventContracts> {
    constructor(streamPool?: CoreEventStreamPoolService) {
        super("preview", previewLifecycleEventContracts, streamPool);
    }
}
