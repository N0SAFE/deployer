import { Injectable } from "@nestjs/common";
import { BaseEventService } from "@/core/modules/events/base-event.service";
import {
    previewLifecycleEventContracts,
    type PreviewLifecycleEventContracts,
} from "./preview-lifecycle-event.contracts";

// T037: Preview lifecycle audit trail event service.
@Injectable()
export class PreviewLifecycleEventService extends BaseEventService<PreviewLifecycleEventContracts> {
    constructor() {
        super("preview", previewLifecycleEventContracts);
    }
}
