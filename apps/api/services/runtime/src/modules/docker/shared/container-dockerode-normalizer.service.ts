import { Injectable } from "@nestjs/common"
import { createHash } from "node:crypto"
import type { DockerContainer, DockerPortBinding, DockerodeContainerList } from "@repo/contracts-entities"
import { dockerContainerSchema } from "@repo/contracts-entities"
import { isRecord } from "@repo/type-guards"

// ─── Constants ───────────────────────────────────────────────────────────────

const DOCKER_CONTAINER_STATUSES: DockerContainer["status"][] = [
  "created", "running", "paused", "restarting", "exited", "dead", "unknown",
]

const DOCKER_CONTAINER_HEALTH_STATUSES: DockerContainer["health"][] = [
  "healthy", "unhealthy", "starting", "none",
]

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContainerHashInput {
  managedBy: DockerContainer["managedBy"]
  managedDeploymentId: string | null
  managedServiceId: string | null
  managedProjectId: string | null
  projectId: string
  serviceId: string
  name: string
  imageId: string | null
  environment: DockerContainer["environment"]
  ports: DockerPortBinding[]
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Normalizes raw dockerode container responses into typed domain entities.
 *
 * This service handles ONLY docker-specific conversion logic:
 *   - Parsing dockerode list/inspect shapes
 *   - Extracting container status, health, ports, networks, mounts
 *   - Computing container identity hashes
 *
 * It does NOT resolve cross-module concerns (deployment/service/project IDs,
 * environment aliases, ownership). Those are handled by the deployment
 * module's ContainerLinkService, which enriches containers after they leave
 * the docker domain boundary.
 *
 * The `normalizeContainer()` method accepts `overrides` for the fields that
 * require cross-module resolution — the caller (e.g. the repository or a
 * linking service) is responsible for providing those values.
 */
@Injectable()
export class ContainerDockerodeNormalizer {
  /**
   * Parse a raw dockerode container list entry into a validated domain container.
   *
   * @param raw - The raw dockerode container list entry (validated by Zod).
   * @param overrides - Cross-module fields (projectId, serviceId, environment,
   *                    managedBy, etc.) that must be resolved by the caller.
   */
  normalizeContainer(
    raw: DockerodeContainerList,
    overrides: {
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
    },
  ): DockerContainer {
    const labels = raw.Labels ?? {}

    const rawPorts = raw.Ports ?? []
    const ports: { containerPort: number; hostPort: number | null; protocol: "tcp" | "udp" }[] = rawPorts.map((port) => ({
      containerPort: port.PrivatePort ?? 0,
      hostPort: port.PublicPort ?? null,
      protocol: (port.Type ?? "tcp") === "udp" ? "udp" : "tcp",
    }))

    const networkIds = Object.keys(
      (raw.NetworkSettings as { Networks?: Record<string, unknown> } | undefined)?.Networks ?? {},
    )

    const createdAt =
      typeof raw.Created === "number"
        ? new Date(raw.Created * 1000).toISOString()
        : new Date().toISOString()

    const name = String(raw.Names?.[0] ?? "").replace(/^\//, "") || String(raw.Id ?? "unknown-container")
    const containerId = String(raw.Id ?? "")
    const imageId = typeof raw.ImageID === "string" && raw.ImageID.length > 0 ? raw.ImageID : null
    const imageRef = typeof raw.Image === "string" && raw.Image.length > 0 ? raw.Image : "unknown-image"

    const networkMode =
      (typeof labels["deployer.network_mode"] === "string" && labels["deployer.network_mode"].trim().length > 0
        ? labels["deployer.network_mode"].trim()
        : null)
      ?? (typeof raw.HostConfig?.NetworkMode === "string" ? raw.HostConfig.NetworkMode : null)

    const volumeIds = raw.Mounts
      .filter((mount) => typeof mount.Name === "string" && mount.Name.length > 0)
      .map((mount) => (mount.Name as string))

    const stateText = typeof raw.State === "string" ? raw.State : undefined

    const hash = this.buildContainerHash({
      managedBy: overrides.managedBy,
      managedDeploymentId: overrides.managedDeploymentId,
      managedServiceId: overrides.managedServiceId,
      managedProjectId: overrides.managedProjectId,
      projectId: overrides.projectId,
      serviceId: overrides.serviceId,
      name,
      imageId,
      environment: overrides.environment,
      ports,
    })

    return dockerContainerSchema.parse({
      id: containerId,
      hash,
      name,
      projectId: overrides.projectId,
      serviceId: overrides.serviceId,
      stackId: labels["com.docker.compose.project"] ?? labels["com.docker.stack.namespace"] ?? null,
      imageId,
      status: this.normalizeContainerStatus(stateText),
      health: this.extractHealthStatusFromContainerSummary(raw),
      environment: overrides.environment,
      cpuPercent: null,
      memoryPercent: null,
      restartCount: 0,
      ports,
      networkIds,
      volumeIds,
      managedBy: overrides.managedBy,
      managedReason: overrides.managedReason,
      managedDeploymentId: overrides.managedDeploymentId,
      managedServiceId: overrides.managedServiceId,
      managedProjectId: overrides.managedProjectId,
      managedImageRef: overrides.managedImageRef,
      managedNetworkMode: overrides.managedNetworkMode,
      logsStreamId: overrides.logsStreamId,
      startedAt: null,
      createdAt,
      updatedAt: new Date().toISOString(),
    })
  }

  // ─── Status normalization ──────────────────────────────────────────────────

  normalizeContainerStatus(state: string | undefined): DockerContainer["status"] {
    const normalized = (state ?? "unknown").toLowerCase()
    return DOCKER_CONTAINER_STATUSES.includes(normalized as DockerContainer["status"])
      ? (normalized as DockerContainer["status"])
      : "unknown"
  }

  normalizeHealthStatus(status: string | undefined): DockerContainer["health"] {
    const normalized = (status ?? "none").toLowerCase()
    return DOCKER_CONTAINER_HEALTH_STATUSES.includes(normalized as DockerContainer["health"])
      ? (normalized as DockerContainer["health"])
      : "none"
  }

  private extractHealthStatusFromContainerSummary(
    container: DockerodeContainerList,
  ): DockerContainer["health"] {
    const status = container.Status ?? ""
    if (/healthy/i.test(status)) return "healthy"
    if (/unhealthy/i.test(status)) return "unhealthy"
    if (/starting/i.test(status)) return "starting"
    return "none"
  }

  // ─── Hash computation ─────────────────────────────────────────────────────

  buildContainerHash(input: ContainerHashInput): string {
    const raw = [
      input.managedBy,
      input.managedDeploymentId ?? "",
      input.managedServiceId ?? "",
      input.managedProjectId ?? "",
      input.projectId,
      input.serviceId,
      input.name,
      input.imageId ?? "",
      input.environment ?? "",
      ...input.ports.map((p) => `${p.containerPort}:${p.hostPort ?? ""}:${p.protocol}`),
    ].join("|")

    return createHash("sha256").update(raw).digest("hex").slice(0, 16)
  }

  // ─── Filter helpers ───────────────────────────────────────────────────────

  /**
   * Extract a filter entry from the list input by field name.
   */
  getFilterEntry<TInput extends { filter?: Record<string, unknown> }>(
    input: TInput,
    field: string,
  ): { op: string; value: string } | undefined {
    const filter = input.filter
    if (!isRecord(filter)) return undefined

    const rawEntry = filter[field]
    if (!isRecord(rawEntry)) return undefined

    const entry = rawEntry as { op?: string; value?: string }
    if (typeof entry.op !== "string" || typeof entry.value !== "string") return undefined

    return { op: entry.op, value: entry.value }
  }

  matchString(value: string, entry: { op: string; value: string } | undefined): boolean {
    if (!entry) return true
    const str = value.toLowerCase()
    const pattern = entry.value.toLowerCase()
    switch (entry.op) {
      case "eq": return str === pattern
      case "neq": return str !== pattern
      case "contains": return str.includes(pattern)
      case "startsWith": return str.startsWith(pattern)
      case "endsWith": return str.endsWith(pattern)
      default: return true
    }
  }

  matchEq(value: string | boolean, entry: { op: string; value: string } | undefined): boolean {
    if (!entry) return true
    const normalized = typeof value === "boolean" ? String(value) : value.toLowerCase()
    const pattern = entry.value.toLowerCase()
    switch (entry.op) {
      case "eq": return normalized === pattern
      case "neq": return normalized !== pattern
      default: return true
    }
  }

  matchNullableStringEq(
    value: string | null,
    entry: { op: string; value: string } | undefined,
  ): boolean {
    if (!entry) return true
    if (value === null) return false
    return this.matchEq(value, entry)
  }
}

