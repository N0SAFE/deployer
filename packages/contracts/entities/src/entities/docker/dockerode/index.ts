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
 * import { dockerodeContainerListSchema } from "@deployer/contracts-entities"
 * import z from "zod/v4"
 *
 * const raw = await docker.listContainers({ all: true })
 * const containers = z.array(dockerodeContainerListSchema).parse(raw)
 * // containers[0].Id is string, containers[0].Ports is typed
 * ```
 */

export {
  dockerodePortSchema,
  dockerodePortBindingSchema,
  dockerodeMountSchema,
  dockerodeContainerListSchema,
  dockerodeNetworkAttachmentSchema,
  dockerodePortMapSchema,
  dockerodeHealthcheckConfigSchema,
  dockerodeRestartPolicySchema,
  dockerodeContainerInspectSchema,
  type DockerodePort,
  type DockerodePortBinding,
  type DockerodeMount,
  type DockerodeContainerList,
  type DockerodeNetworkAttachment,
  type DockerodePortMap,
} from "@deployer/contracts-entities/entities/docker/dockerode/containers.schema"

export {
  dockerodeImageSummarySchema,
  dockerodeImageConfigSchema,
  dockerodeImageInspectSchema,
  type DockerodeImageSummary,
  type DockerodeImageInspect,
} from "@deployer/contracts-entities/entities/docker/dockerode/images.schema"

export {
  dockerodeNetworkIpamConfigSchema,
  dockerodeNetworkIpamSchema,
  dockerodeNetworkContainerAttachmentSchema,
  dockerodeNetworkSummarySchema,
  type DockerodeNetworkSummary,
} from "@deployer/contracts-entities/entities/docker/dockerode/networks.schema"

export {
  dockerodeVolumeEntrySchema,
  dockerodeVolumeListResponseSchema,
  type DockerodeVolumeEntry,
  type DockerodeVolumeListResponse,
} from "@deployer/contracts-entities/entities/docker/dockerode/volumes.schema"
