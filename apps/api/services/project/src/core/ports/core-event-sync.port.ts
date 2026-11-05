import { Context } from "effect";

import type { CoreEventSyncServiceShape } from "@deployer/shared/core/modules/events/services/core-event-sync.service";

/** Effect view of the cross-service event sync. */
export type CoreEventSyncShape = Pick<
	CoreEventSyncServiceShape,
	"registerNamespaceAdapter" | "selectMany"
>;

export class CoreEventSync extends Context.Service<
	CoreEventSync,
	CoreEventSyncShape
>()("project/CoreEventSync") {}
