import { oc } from "@orpc/contract";
import { dockerContainerProcessesContract } from "./list";

export const dockerContainerProcessesNamespaceContract = oc
  .tag("Docker Container Processes")
  .prefix("/processes")
  .router({
    list: dockerContainerProcessesContract,
  });

export { dockerContainerProcessesContract };
