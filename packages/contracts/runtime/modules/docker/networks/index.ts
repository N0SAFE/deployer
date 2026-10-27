import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { dockerListNetworksContract } from "./list";

export const dockerNetworksContract = oc.meta(openapi({ tags: ["Docker Networks"], prefix: "/networks" })).router({
  list: dockerListNetworksContract,
});

export { dockerListNetworksContract };
export { dockerNetworkListConfigSchemas } from "./list";
export type { DockerNetworkListInput } from "./list";
