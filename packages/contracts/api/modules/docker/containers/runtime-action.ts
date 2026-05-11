import { standard } from "@repo/orpc-utils";
import {
  dockerContainerRuntimeActionAckSchema,
  dockerContainerRuntimeActionBodySchema,
} from "./shared";

const dockerContainerRuntimeActionOps = standard.zod(
  dockerContainerRuntimeActionAckSchema,
  "dockerContainerRuntimeAction",
);

export const dockerContainerRuntimeActionContract = dockerContainerRuntimeActionOps
  .create()
  .path("/action")
  .input((b) => b.body(dockerContainerRuntimeActionBodySchema))
  .output((b) => b.body(dockerContainerRuntimeActionAckSchema))
  .build();