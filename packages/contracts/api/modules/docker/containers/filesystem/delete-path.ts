import { standard } from "@repo/orpc-utils";
import {
  dockerContainerDeletePathBodySchema,
  dockerContainerTerminalMutationAckSchema,
} from "../shared";

const dockerContainerDeletePathOps = standard.zod(
  dockerContainerTerminalMutationAckSchema,
  "dockerContainerDeletePath",
);

export const dockerContainerDeletePathContract = dockerContainerDeletePathOps
  .create()
  .path("/delete")
  .input((b) => b.body(dockerContainerDeletePathBodySchema))
  .output((b) => b.body(dockerContainerTerminalMutationAckSchema))
  .build();