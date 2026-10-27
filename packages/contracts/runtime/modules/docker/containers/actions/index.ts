import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { dockerContainerRuntimeActionContract } from "../runtime-action";

export const dockerContainerActionsContract = oc.meta(openapi({ tags: ["Docker Container Actions"], prefix: "/runtime" })).router({
  run: dockerContainerRuntimeActionContract,
});
