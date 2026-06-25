import { standard } from "@repo/orpc-utils";
import { dockerRuntimeActivityEntitySchema } from "@repo/contracts-entities";
import z from "zod/v4";

/**
 * Live activity stream. The server emits one `DockerRuntimeActivityEntity`
 * per `DockerRuntimeEvent`, projected to the activity shape (status,
 * category, severity, progress, scanner state, ...).
 *
 * This is the "perfect DX" replacement for the legacy
 * `useEventTrigger` + `DockerRuntimeEvent` mapping: instead of letting the
 * client re-derive activity projections from raw runtime events, the
 * server publishes the activity entity directly.
 */
const dockerRuntimeActivityStreamQuerySchema = z
  .object({
    source: z.string().optional(),
    action: z.string().optional(),
  })
  .optional()

export type DockerRuntimeActivityStreamInput = z.infer<typeof dockerRuntimeActivityStreamQuerySchema>

const dockerRuntimeActivityStreamOps = standard.zod(
  dockerRuntimeActivityEntitySchema,
  "dockerRuntimeActivityStream",
)

export const dockerRuntimeActivityStreamContract = dockerRuntimeActivityStreamOps
  .list()
  .path("/activity/stream")
  .input((b) => b.query(dockerRuntimeActivityStreamQuerySchema))
  .output((b) => b.observable(dockerRuntimeActivityEntitySchema))
  .build()
