import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { dockerContainerLogsListContract } from "./list";

export const dockerContainerLogsContract = oc.meta(openapi({ tags: ["Docker Container Logs"], prefix: "/logs" })).router({
  list: dockerContainerLogsListContract,
});

export { dockerContainerLogsListContract };
