import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerContainerLogEntrySchema } from "@repo/contracts-entities";
import { dockerContainerLogsStreamQuerySchema } from "../shared";

const dockerContainerLogStreamOps = standard.zod(
  dockerContainerLogEntrySchema,
  "dockerContainerLogStream",
);

export const dockerContainerLogsStreamContract = dockerContainerLogStreamOps
  .list()
  .path("/logs/stream")
  .input((b) => b.query(dockerContainerLogsStreamQuerySchema))
  .output((b) => b.observable(dockerContainerLogEntrySchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();