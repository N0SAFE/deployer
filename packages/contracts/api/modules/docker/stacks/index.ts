import { oc } from "@orpc/contract";
import { dockerListStacksContract } from "./list";

export const dockerStacksContract = oc.tag("Docker Stacks").prefix("/stacks").router({
  list: dockerListStacksContract,
});

export { dockerListStacksContract };
export { dockerStackListConfigSchemas } from "./list";
export type { DockerStackListInput } from "./list";
