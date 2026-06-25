import { standard } from "@repo/orpc-utils";
import { dockerEntityStreamChunkSchema } from "@repo/contracts-entities";
import { dockerEntityListInputSchema } from "./shared";
import z from "zod/v4";

/**
 * `data` reuses the discriminated `DockerEntityStreamChunk` shape so a
 * client can hydrate the in-memory store directly from the list payload
 * (or ignore the metadata and re-apply events as usual).
 */
const dockerEntityListResponseSchema = z.object({
  kind: z.string().min(1),
  data: z.array(dockerEntityStreamChunkSchema),
  etag: z.string().min(1).optional(),
})
export type DockerEntityListResponse = z.infer<typeof dockerEntityListResponseSchema>

const dockerEntityListOps = standard.zod(
  dockerEntityListResponseSchema,
  "dockerEntityList",
)

export const dockerEntityListContract = dockerEntityListOps
  .list()
  .path("/list")
  .input((b) => b.body(dockerEntityListInputSchema))
  .output((b) => b.body(dockerEntityListResponseSchema))
  .build()
