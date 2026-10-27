import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { dockerContainerProcessesContract } from "./list";

export const dockerContainerProcessesNamespaceContract = oc.meta(openapi({ tags: ["Docker Container Processes"], prefix: "/processes" })).router({
    list: dockerContainerProcessesContract,
  });

export { dockerContainerProcessesContract };
