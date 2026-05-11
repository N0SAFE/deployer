import { oc } from "@orpc/contract";
import { dockerContainerLogsListContract } from "./list";

export const dockerContainerLogsContract = oc.tag("Docker Container Logs").prefix("/logs").router({
  list: dockerContainerLogsListContract,
});

export { dockerContainerLogsListContract };
