import { Context } from "effect";

import { BasePooledEventService } from "@deployer/shared/core/modules/events/base/index";
import type { CoreEventStreamPoolServiceShape } from "@deployer/shared/core/modules/events/base/index";

import {
    previewLifecycleEventContracts,
    type PreviewLifecycleEventContracts,
} from "./preview-lifecycle-event.contracts";

// T037: Preview lifecycle audit trail event service.
export class PreviewLifecycleEventServiceImpl extends BasePooledEventService<PreviewLifecycleEventContracts, "preview"> {
    constructor(streamPool?: CoreEventStreamPoolServiceShape) {
        super("preview", previewLifecycleEventContracts, streamPool);
    }
}

/** What consumers may do with the bus: publish and subscribe. */
export type PreviewLifecycleEventServiceShape = Pick<PreviewLifecycleEventServiceImpl, "emitEffect" | "subscribeEffect">;

/** Effect key = NestJS token; the module builds the instance over the shared stream pool. */
export class PreviewLifecycleEventService extends Context.Service<PreviewLifecycleEventService, PreviewLifecycleEventServiceShape>()(
    "fleet/PreviewLifecycleEventService",
) {}
