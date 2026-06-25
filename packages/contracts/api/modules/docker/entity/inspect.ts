import { standard } from "@repo/orpc-utils";
import { dockerEntityStreamChunkSchema } from "@repo/contracts-entities";
import { dockerEntityInspectInputSchema } from "./shared";
import z from "zod/v4";

const dockerEntityInspectResponseSchema = z.union([
  dockerEntityStreamChunkSchema,
  z.null(),
])
export type DockerEntityInspectResponse = z.infer<typeof dockerEntityInspectResponseSchema>

const dockerEntityInspectOps = standard.zod(
  dockerEntityInspectResponseSchema,
  "dockerEntityInspect",
)

export const dockerEntityInspectContract = dockerEntityInspectOps
  .list()
  .path("/inspect")
  .input((b) => b.body(dockerEntityInspectInputSchema))
  .output((b) => b.body(dockerEntityInspectResponseSchema))
  .build()
