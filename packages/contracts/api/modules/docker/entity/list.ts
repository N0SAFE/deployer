import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerEntityStreamChunkSchema } from "@repo/contracts-entities";
import { dockerEntityListInputSchema } from "./shared";
import z from "zod/v4";

/**
 * `data` reuses the discriminated `DockerEntityStreamChunk` shape so a
 * client can hydrate the in-memory store directly from the list payload
 * (or ignore the metadata and re-apply events as usual).
 *
 * `etag` and `hit` are optional metadata: the server returns an etag
 * fingerprint for the snapshot (so the client can do conditional
 * re-renders) and a `hit` flag so the client can tell whether the
 * payload came from the in-memory cache or was freshly computed.
 */
const dockerEntityListResponseSchema = z.object({
  kind: z.string().min(1),
  data: z.array(dockerEntityStreamChunkSchema),
  etag: z.string().min(1).optional(),
  hit: z.boolean().optional(),
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
  .errors((e) => [
    // Docker daemon unreachable / permission errors surface here.
    ...standardDomainErrorContracts(e),
  ])
  .build()
