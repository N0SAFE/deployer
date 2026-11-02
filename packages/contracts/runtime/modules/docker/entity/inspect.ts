import z from "zod/v4";

import { dockerEntityStreamChunkSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { dockerEntityInspectInputSchema } from "./shared";


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
  .errors((e) => [
    // 400 unsupported entity kind.
    ...standardDomainErrorContracts(e),
  ])
  .build()
