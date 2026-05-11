import { standard } from "@repo/orpc-utils";
import { dockerContainerInspectDetailSchema } from "@repo/contracts-entities";
import { dockerContainerInspectStreamQuerySchema } from "../shared";

const dockerContainerInspectStreamOps = standard.zod(
  dockerContainerInspectDetailSchema,
  "dockerContainerInspectStream",
);

export const dockerContainerInspectStreamContract = dockerContainerInspectStreamOps
  .list()
  .path("/inspect/stream")
  .input((b) => b.query(dockerContainerInspectStreamQuerySchema))
  .output((b) => b.observable(dockerContainerInspectDetailSchema))
  .build();