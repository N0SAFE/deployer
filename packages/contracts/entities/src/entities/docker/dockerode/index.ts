/**
 * @fileoverview Barrel exports for raw dockerode Zod schemas.
 *
 * These schemas describe the raw JSON shapes returned by the Docker
 * socket API (via dockerode). They are the **input** to the normalization
 * pipeline — use them at the DockerRepository → dockerode boundary to
 * replace `as Record<string, unknown>` casts with validations.
 *
 * @example
 * ```typescript
 * import { dockerodeContainerListSchema } from "@repo/contracts-entities"
 * import z from "zod/v4"
 *
 * const raw = await docker.listContainers({ all: true })
 * const containers = z.array(dockerodeContainerListSchema).parse(raw)
 * // containers[0].Id is string, containers[0].Ports is typed
 * ```
 */

export {
  dockerodePortBindingSchema,
  dockerodeMountSchema,
  dockerodeContainerListSchema,
  dockerodeNetworkAttachmentSchema,
  dockerodePortMapSchema,
  dockerodeHealthcheckConfigSchema,
  dockerodeRestartPolicySchema,
  dockerodeContainerInspectSchema,
  type DockerodePortBinding,
  type DockerodeMount,
  type DockerodeContainerList,
  type DockerodeNetworkAttachment,
  type DockerodePortMap,
} from "./containers.schema"

export {
  dockerodeImageSummarySchema,
  dockerodeImageConfigSchema,
  dockerodeImageInspectSchema,
  type DockerodeImageSummary,
  type DockerodeImageInspect,
} from "./images.schema"

export {
  dockerodeNetworkIpamConfigSchema,
  dockerodeNetworkIpamSchema,
  dockerodeNetworkContainerAttachmentSchema,
  dockerodeNetworkSummarySchema,
  type DockerodeNetworkSummary,
} from "./networks.schema"

export {
  dockerodeVolumeEntrySchema,
  dockerodeVolumeListResponseSchema,
  type DockerodeVolumeEntry,
  type DockerodeVolumeListResponse,
} from "./volumes.schema"
