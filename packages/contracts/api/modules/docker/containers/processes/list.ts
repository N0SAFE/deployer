import { standard } from "@repo/orpc-utils";
import {
  dockerContainerProcessesQuerySchema,
  dockerContainerProcessesSnapshotSchema,
} from "../shared";

const dockerContainerProcessesOps = standard.zod(
  dockerContainerProcessesSnapshotSchema,
  "dockerContainerProcesses",
);

export const dockerContainerProcessesContract = dockerContainerProcessesOps
  .list()
  .path("/")
  .input((b) => b.query(dockerContainerProcessesQuerySchema))
  .output((b) => b.body(dockerContainerProcessesSnapshotSchema))
  .build();