import { standard } from "@repo/orpc-utils";
import { dockerEntityStreamChunkSchema } from "@repo/contracts-entities";
import { dockerEntityStreamInputSchema } from "./shared";

const dockerEntityStreamOps = standard.zod(
  dockerEntityStreamChunkSchema,
  "dockerEntityStreamChunk",
)

/**
 * Unified docker entity stream. Emits `DockerEntityStreamChunk` values:
 * either a full `DockerEntityEvent` (with the entity payload and
 * relations) or a `DockerEntityRemovedEvent` (just `{ kind, id }`).
 *
 * The server pre-fetches the entity payload server-side so the client
 * never has to follow up with an inspect call.
 */
export const dockerEntityStreamContract = dockerEntityStreamOps
  .list()
  .path("/stream")
  .input((b) => b.query(dockerEntityStreamInputSchema))
  .output((b) => b.observable(dockerEntityStreamChunkSchema))
  .build()
