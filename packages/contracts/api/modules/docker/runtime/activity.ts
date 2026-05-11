import { oc } from "@orpc/contract";
import { dockerRuntimeActivityListContract } from "./activity-list";
import { dockerRuntimeActivityDetailContract } from "./activity-detail";

export const dockerRuntimeActivityContract = oc.tag("Docker Runtime Activity").prefix("/activity").router({
  list: dockerRuntimeActivityListContract,
  detail: dockerRuntimeActivityDetailContract,
});

export { dockerRuntimeActivityListContract } from "./activity-list";
export { dockerRuntimeActivityDetailContract } from "./activity-detail";
export { dockerRuntimeActivityListConfigSchemas } from "./activity-list";
export { dockerRuntimeActivityDetailQuerySchema } from "./activity-detail";

export type { DockerRuntimeActivityListInput } from "./activity-list";
export type { DockerRuntimeActivityDetailQueryInput } from "./activity-detail";
