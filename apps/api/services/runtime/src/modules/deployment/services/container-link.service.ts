import { Context } from "effect"

import type { DockerContainer } from "@deployer/contracts-entities"
import type { ContainerEnrichment, IContainerLinkResolver } from "@deployer/docker";

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
function resolveEnrichment(
  labels: Record<string, string>,
  name: string,
  containerId: string,
  imageRef: string,
  networkMode: string | null,
): ContainerEnrichment {
  const deploymentId = readLabel(labels, "deployer.deployment_id")
  const serviceIdLabel = readLabel(labels, "deployer.service_id")
  const projectIdLabel = readLabel(labels, "deployer.project_id")

  const serviceId =
    serviceIdLabel
    ?? readLabel(labels, "com.docker.compose.service")
    ?? readLabel(labels, "com.docker.swarm.service.name")
    ?? readLabel(labels, "com.docker.stack.service.name")
    ?? readLabel(labels, "service")
    ?? readLabel(labels, "name")
    ?? containerId

  const projectId =
    projectIdLabel
    ?? readLabel(labels, "deployer.project_id")
    ?? readLabel(labels, "com.docker.compose.project")
    ?? readLabel(labels, "com.docker.stack.namespace")
    ?? readLabel(labels, "com.docker.stack.project")
    ?? readLabel(labels, "project")
    ?? serviceId

  const environment = resolveEnvironment(labels, name)

  const isManagedByDeployment = !!(deploymentId || serviceIdLabel || projectIdLabel)

  const managedImageRef = readLabel(labels, "deployer.image_ref")
  const managedNetworkMode = readLabel(labels, "deployer.network_mode") ?? networkMode

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

function readLabel(labels: Record<string, string>, key: string): string | null {
  const val = labels[key]
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : null
}

function resolveEnvironment(
  labels: Record<string, string>,
  name: string,
): DockerContainer["environment"] {
  const candidates = [
    readLabel(labels, "deployer.environment"),
    readLabel(labels, "deployer.env"),
    readLabel(labels, "environment"),
    readLabel(labels, "env"),
    readLabel(labels, "node_env"),
    readLabel(labels, "app_env"),
    parseEnvironmentFromContainerName(name),
  ]

  for (const candidate of candidates) {
    if (candidate) {
      const normalized = normalizeEnvironment(candidate)
      if (normalized) return normalized
    }
  }
  return null
}

function parseEnvironmentFromContainerName(name: string): string | null {
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

function normalizeEnvironment(value: string): DockerContainer["environment"] {
  const normalized = value.trim().toLowerCase()
  return DEPLOYMENT_ENVIRONMENT_ALIASES[normalized] ?? null
}

export class DeploymentContainerLinkService extends Context.Service<
  DeploymentContainerLinkService,
  IContainerLinkResolver
>()("runtime/DeploymentContainerLinkService") {
  static readonly live: IContainerLinkResolver = { resolveEnrichment }
}
