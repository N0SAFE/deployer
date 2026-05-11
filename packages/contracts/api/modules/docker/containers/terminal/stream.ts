import { standard } from "@repo/orpc-utils";
import {
  dockerContainerTerminalSessionEventSchema,
  dockerContainerTerminalStreamQuerySchema,
} from "../shared";

const dockerContainerTerminalStreamOps = standard.zod(
  dockerContainerTerminalSessionEventSchema,
  "dockerContainerTerminalStream",
);

export const dockerContainerTerminalStreamContract = dockerContainerTerminalStreamOps
  .list()
  .path("/stream")
  .input((b) => b.query(dockerContainerTerminalStreamQuerySchema))
  .output((b) => b.observable(dockerContainerTerminalSessionEventSchema))
  .build();