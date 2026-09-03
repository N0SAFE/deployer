import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerContainerLogEntrySchema } from "@repo/contracts-entities";
import { dockerContainerProcessLogsStreamQuerySchema } from "../shared";

const dockerContainerProcessLogStreamOps = standard.zod(
  dockerContainerLogEntrySchema,
  "dockerContainerProcessLogStream",
);

export const dockerContainerProcessLogsStreamContract = dockerContainerProcessLogStreamOps
  .list()
  .path("/processes/logs/stream")
  .input((b) => b.query(dockerContainerProcessLogsStreamQuerySchema))
  .output((b) => b.observable(dockerContainerLogEntrySchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();