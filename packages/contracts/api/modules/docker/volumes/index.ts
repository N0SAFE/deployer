import { oc } from "@orpc/contract";
import { dockerListVolumesContract } from "./list";

export const dockerVolumesContract = oc.tag("Docker Volumes").prefix("/volumes").router({
  list: dockerListVolumesContract,
});

export { dockerListVolumesContract };
export { dockerVolumeListConfigSchemas } from "./list";
export type { DockerVolumeListInput } from "./list";
