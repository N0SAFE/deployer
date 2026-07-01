import { Injectable } from "@nestjs/common"
import type { DockerContainer } from "@repo/contracts-entities"
import type { ContainerEnrichment, IContainerLinkResolver } from "@/core/modules/docker/services/container-link-resolver.interface"

// ─── Constants ───────────────────────────────────────────────────────────────

const DEPLOYMENT_ENVIRONMENT_ALIASES: Record<string, DockerContainer["environment"]> = {
  prod: "production",
  production: "production",
  live: "production",
  staging: "staging",
  stage: "staging",
  dev: "development",
  development: "development",
  test: "development",
  testing: "development",
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Resolves deployment/service/project enrichment for containers.
 *
 * This service implements IContainerLinkResolver and belongs to the deployment
 * module because it reads deployment-specific labels (deployer.deployment_id,
 * deployer.service_id, deployer.project_id, etc.).
 *
 * The docker module depends on the IContainerLinkResolver INTERFACE only.
 * The core module wires this implementation into the docker pipeline.
 */
@Injectable()
export class DeploymentContainerLinkService implements IContainerLinkResolver {
  resolveEnrichment(
    labels: Record<string, string>,
    name: string,
    containerId: string,
    imageRef: string,
    networkMode: string | null,
  ): ContainerEnrichment {
    const deploymentId = this.readLabel(labels, "deployer.deployment_id")
    const serviceIdLabel = this.readLabel(labels, "deployer.service_id")
    const projectIdLabel = this.readLabel(labels, "deployer.project_id")

    const serviceId =
      serviceIdLabel
      ?? this.readLabel(labels, "com.docker.compose.service")
      ?? this.readLabel(labels, "com.docker.swarm.service.name")
      ?? this.readLabel(labels, "com.docker.stack.service.name")
      ?? this.readLabel(labels, "service")
      ?? this.readLabel(labels, "name")
      ?? containerId

    const projectId =
      projectIdLabel
      ?? this.readLabel(labels, "deployer.project_id")
      ?? this.readLabel(labels, "com.docker.compose.project")
      ?? this.readLabel(labels, "com.docker.stack.namespace")
      ?? this.readLabel(labels, "com.docker.stack.project")
      ?? this.readLabel(labels, "project")
      ?? serviceId

    const environment = this.resolveEnvironment(labels, name)

    const isManagedByDeployment = !!(deploymentId || serviceIdLabel || projectIdLabel)

    const managedImageRef = this.readLabel(labels, "deployer.image_ref")
    const managedNetworkMode = this.readLabel(labels, "deployer.network_mode") ?? networkMode

    if (isManagedByDeployment) {
      return {
        projectId,
        serviceId,
        environment,
        managedBy: "deployment_service",
        managedReason: "Deployment managed container",
        managedDeploymentId: deploymentId,
        managedServiceId: serviceIdLabel,
        managedProjectId: projectIdLabel,
        managedImageRef,
        managedNetworkMode,
        logsStreamId: deploymentId,
      }
    }

    return {
      projectId,
      serviceId,
      environment,
      managedBy: "orphan",
      managedReason: null,
      managedDeploymentId: null,
      managedServiceId: null,
      managedProjectId: null,
      managedImageRef: null,
      managedNetworkMode: null,
      logsStreamId: null,
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private readLabel(labels: Record<string, string>, key: string): string | null {
    const val = labels[key]
    return typeof val === "string" && val.trim().length > 0 ? val.trim() : null
  }

  private resolveEnvironment(
    labels: Record<string, string>,
    name: string,
  ): DockerContainer["environment"] {
    const candidates = [
      this.readLabel(labels, "deployer.environment"),
      this.readLabel(labels, "deployer.env"),
      this.readLabel(labels, "environment"),
      this.readLabel(labels, "env"),
      this.readLabel(labels, "node_env"),
      this.readLabel(labels, "app_env"),
      this.parseEnvironmentFromContainerName(name),
    ]

    for (const candidate of candidates) {
      if (candidate) {
        const normalized = this.normalizeEnvironment(candidate)
        if (normalized) return normalized
      }
    }
    return null
  }

  private parseEnvironmentFromContainerName(name: string): string | null {
    const segments = name
      .toLowerCase()
      .split(/[-_.]/g)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    for (const segment of segments) {
      const mapped = DEPLOYMENT_ENVIRONMENT_ALIASES[segment]
      if (mapped) return segment
    }
    return null
  }

  private normalizeEnvironment(value: string): DockerContainer["environment"] {
    const normalized = value.trim().toLowerCase()
    return DEPLOYMENT_ENVIRONMENT_ALIASES[normalized] ?? null
  }
}
