import { standard } from "@repo/orpc-utils";
import {
  dockerContainerTerminalCloseBodySchema,
  dockerContainerTerminalMutationAckSchema,
} from "../shared";

const dockerContainerTerminalCloseOps = standard.zod(
  dockerContainerTerminalMutationAckSchema,
  "dockerContainerTerminalClose",
);

export const dockerContainerTerminalCloseContract = dockerContainerTerminalCloseOps
  .create()
  .path("/close")
  .input((b) => b.body(dockerContainerTerminalCloseBodySchema))
  .output((b) => b.body(dockerContainerTerminalMutationAckSchema))
  .build();