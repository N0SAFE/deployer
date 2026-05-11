import { oc } from "@orpc/contract";
import { dockerRuntimeSnapshotContract } from "./snapshot";
import { dockerRuntimeEventsStreamContract } from "./stream";
import { dockerRuntimeActivityContract } from "./activity";

export const dockerRuntimeContract = oc.tag("Docker Runtime").prefix("/runtime").router({
  snapshot: dockerRuntimeSnapshotContract,
  stream: dockerRuntimeEventsStreamContract,
  activity: dockerRuntimeActivityContract,
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
  dockerRuntimeSnapshotContract,
  dockerRuntimeEventsStreamContract,
};
export type {
  DockerRuntimeStreamFilterInput,
  DockerRuntimeEventsStreamQueryInput,
} from "./shared";

export type {
  DockerRuntimeActivityListInput,
  DockerRuntimeActivityDetailQueryInput,
} from "./activity";