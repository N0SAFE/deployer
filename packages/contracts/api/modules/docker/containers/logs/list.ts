import { standard } from "@repo/orpc-utils";
import {
  dockerContainerLogsSnapshotSchema,
  dockerContainerLogsStreamQuerySchema,
} from "../shared";

const dockerContainerLogsOps = standard.zod(
  dockerContainerLogsSnapshotSchema,
  "dockerContainerLogs",
);

export const dockerContainerLogsListContract = dockerContainerLogsOps
  .list()
  .path("/")
  .input((b) => b.query(dockerContainerLogsStreamQuerySchema))
  .output((b) => b.body(dockerContainerLogsSnapshotSchema))
  .build();
