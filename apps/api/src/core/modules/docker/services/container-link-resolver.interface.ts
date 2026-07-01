import type { DockerContainer } from "@repo/contracts-entities"

/**
 * Enrichment data produced by a link resolver for a single container.
 *
 * These fields require cross-module knowledge (deployment, service, project)
 * and MUST NOT be resolved inside the docker module.
 */
export interface ContainerEnrichment {
  projectId: string
  serviceId: string
  environment: DockerContainer["environment"]
  managedBy: DockerContainer["managedBy"]
  managedReason: string | null
  managedDeploymentId: string | null
  managedServiceId: string | null
  managedProjectId: string | null
  managedImageRef: string | null
  managedNetworkMode: string | null
  logsStreamId: string | null
}

/**
 * DI token for the container link resolver.
 *
 * The docker module's repository depends on this INTERFACE, not on a concrete
 * implementation. The deployment module provides the implementation, and the
 * core module wires them together at module init time.
 */
export const CONTAINER_LINK_RESOLVER = "CONTAINER_LINK_RESOLVER" as const

/**
 * Resolves cross-module enrichment for a container from its labels/metadata.
 *
 * Implementations MUST be stateless — the same labels always produce the same
 * enrichment. Any caching or DB lookups belong inside the implementation.
 */
export interface IContainerLinkResolver {
  resolveEnrichment(
    labels: Record<string, string>,
    name: string,
    containerId: string,
    imageRef: string,
    networkMode: string | null,
  ): ContainerEnrichment
}
