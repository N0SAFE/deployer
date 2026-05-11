import { standard } from "@repo/orpc-utils";
import {
  dockerContainerTerminalInputBodySchema,
  dockerContainerTerminalMutationAckSchema,
} from "../shared";

const dockerContainerTerminalInputOps = standard.zod(
  dockerContainerTerminalMutationAckSchema,
  "dockerContainerTerminalInput",
);

export const dockerContainerTerminalInputContract = dockerContainerTerminalInputOps
  .create()
  .path("/input")
  .input((b) => b.body(dockerContainerTerminalInputBodySchema))
  .output((b) => b.body(dockerContainerTerminalMutationAckSchema))
  .build();