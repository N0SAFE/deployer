import type { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index";
import { Context } from "effect";

/** Effect view of the shared RxJS stream pool. */
export type CoreEventStreamPoolShape = Pick<
	CoreEventStreamPoolService,
	"observePooledStream"
>;

export class CoreEventStreamPool extends Context.Service<
	CoreEventStreamPool,
	CoreEventStreamPoolShape
>()("project/CoreEventStreamPool") {}
