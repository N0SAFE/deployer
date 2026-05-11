import { oc } from "@orpc/contract";
import { dockerContainerRuntimeActionContract } from "../runtime-action";

export const dockerContainerActionsContract = oc.tag("Docker Container Actions").prefix("/runtime").router({
  run: dockerContainerRuntimeActionContract,
});
