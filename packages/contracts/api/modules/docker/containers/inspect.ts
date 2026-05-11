import { standard } from "@repo/orpc-utils";
import { dockerContainerInspectDetailSchema } from "@repo/contracts-entities";
import { dockerContainerInspectQuerySchema } from "./shared";

const dockerContainerInspectOps = standard.zod(
  dockerContainerInspectDetailSchema,
  "dockerContainerInspect",
);

export const dockerContainerInspectContract = dockerContainerInspectOps
  .list()
  .path("/inspect")
  .input((b) => b.query(dockerContainerInspectQuerySchema))
  .output((b) => b.body(dockerContainerInspectDetailSchema))
  .build();