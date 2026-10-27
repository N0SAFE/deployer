import type { CoreEventSyncService } from "@deployer/shared/core/modules/events/services/core-event-sync.service";
import { Context } from "effect";

/** Effect view of the cross-service event sync. */
export type CoreEventSyncShape = Pick<
	CoreEventSyncService,
	"registerNamespaceAdapter" | "selectMany"
>;

export class CoreEventSync extends Context.Service<
	CoreEventSync,
	CoreEventSyncShape
>()("project/CoreEventSync") {}
