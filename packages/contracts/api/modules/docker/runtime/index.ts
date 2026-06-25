import { oc } from "@orpc/contract";
import { dockerRuntimeSnapshotContract } from "./snapshot";
import { dockerRuntimeEventsStreamContract } from "./stream";
import { dockerRuntimeActivityContract } from "./activity";
import { dockerRuntimeActivityStreamContract } from "./activity-stream";

export const dockerRuntimeContract = oc.tag("Docker Runtime").prefix("/runtime").router({
  snapshot: dockerRuntimeSnapshotContract,
  stream: dockerRuntimeEventsStreamContract,
  activity: dockerRuntimeActivityContract,
  activityStream: dockerRuntimeActivityStreamContract,
});

export {
  dockerRuntimeStreamFilterEntitySchema,
  dockerRuntimeStreamFilterConfigSchemas,
  dockerRuntimeStreamFilterInputSchema,
  dockerRuntimeEventsStreamQuerySchema,
} from "./shared";

export {
  dockerRuntimeActivityContract,
  dockerRuntimeActivityListContract,
  dockerRuntimeActivityDetailContract,
  dockerRuntimeActivityListConfigSchemas,
  dockerRuntimeActivityDetailQuerySchema,
} from "./activity";

export { dockerRuntimeActivityStreamContract } from "./activity-stream";

export { dockerRuntimeSnapshotContract } from "./snapshot";
export { dockerRuntimeEventsStreamContract } from "./stream";
export type {
  DockerRuntimeStreamFilterInput,
  DockerRuntimeEventsStreamQueryInput,
} from "./shared";

export type {
  DockerRuntimeActivityListInput,
  DockerRuntimeActivityDetailQueryInput,
} from "./activity";

export type { DockerRuntimeActivityStreamInput } from "./activity-stream";