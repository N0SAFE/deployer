import { oc } from "@orpc/contract";
import { dockerContainerInspectStreamContract } from "./inspect";
import { dockerContainerLogsStreamContract } from "./logs";
import { dockerContainerProcessesStreamContract } from "./processes";
import { dockerContainerProcessLogsStreamContract } from "./process-logs";

export const dockerContainerStreamsContract = oc.tag("Docker Container Streams").router({
  inspect: dockerContainerInspectStreamContract,
  logs: dockerContainerLogsStreamContract,
  processes: dockerContainerProcessesStreamContract,
  processLogs: dockerContainerProcessLogsStreamContract,
});

export {
  dockerContainerInspectStreamContract,
  dockerContainerLogsStreamContract,
  dockerContainerProcessesStreamContract,
  dockerContainerProcessLogsStreamContract,
};
