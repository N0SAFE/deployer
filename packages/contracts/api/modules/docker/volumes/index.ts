import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { dockerListVolumesContract } from "./list";

export const dockerVolumesContract = oc.meta(openapi({ tags: ["Docker Volumes"], prefix: "/volumes" })).router({
  list: dockerListVolumesContract,
});

export { dockerListVolumesContract };
export { dockerVolumeListConfigSchemas } from "./list";
export type { DockerVolumeListInput } from "./list";
