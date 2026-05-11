import { oc } from "@orpc/contract";
import { dockerListNetworksContract } from "./list";

export const dockerNetworksContract = oc.tag("Docker Networks").prefix("/networks").router({
  list: dockerListNetworksContract,
});

export { dockerListNetworksContract };
export { dockerNetworkListConfigSchemas } from "./list";
export type { DockerNetworkListInput } from "./list";
