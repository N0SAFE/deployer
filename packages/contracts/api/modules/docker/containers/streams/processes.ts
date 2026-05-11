import { standard } from "@repo/orpc-utils";
import { dockerContainerProcessesSnapshotSchema } from "../shared";
import { dockerContainerProcessesStreamQuerySchema } from "../shared";

const dockerContainerProcessesStreamOps = standard.zod(
  dockerContainerProcessesSnapshotSchema,
  "dockerContainerProcessesStream",
);

export const dockerContainerProcessesStreamContract = dockerContainerProcessesStreamOps
  .list()
  .path("/processes/stream")
  .input((b) => b.query(dockerContainerProcessesStreamQuerySchema))
  .output((b) => b.observable(dockerContainerProcessesSnapshotSchema))
  .build();