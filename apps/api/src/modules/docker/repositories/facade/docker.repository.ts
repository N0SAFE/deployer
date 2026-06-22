import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import { ScannerContainerManagerService } from "@/core/modules/docker/services/scanner-container-manager.service";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import {
  dockerImageSecurityLifecycle,
  dockerImageSecurityScanHistory,
  dockerImageSecurityScans,
} from "@/config/drizzle/global/schema/docker-security-scan";
import { dockerRuntimeActivities } from "@/config/drizzle/global/schema/docker-runtime-activity";
import { deployments, projects, services } from "@/config/drizzle/global/schema/deployment";
import type { DockerContainerListInput } from "@repo/api-contracts/modules/docker/containers/shared";
import type { DockerImageListInput } from "@repo/api-contracts/modules/docker/images/list";
import type { DockerNetworkListInput } from "@repo/api-contracts/modules/docker/networks/list";
import type { DockerRegistryListInput } from "@repo/api-contracts/modules/docker/registries/list";
import type { DockerStackListInput } from "@repo/api-contracts/modules/docker/stacks/list";
import type { DockerVolumeListInput } from "@repo/api-contracts/modules/docker/volumes/list";
import type {
  DockerRuntimeActivityDetailQueryInput,
  DockerRuntimeActivityListInput,
} from "@repo/api-contracts/modules/docker/runtime/activity";
import {
  dockerContainerSchema,
  dockerContainerLinkedDeploymentSchema,
  dockerContainerLinkedProjectSchema,
  dockerContainerLinkedServiceSchema,
  dockerContainerWithLinksSchema,
  dockerContainerInspectDetailSchema,
  dockerImageSchema,
  dockerImageInspectDetailSchema,
  dockerNetworkSchema,
  dockerRegistrySchema,
  dockerRuntimeActivityEntitySchema,
  dockerRuntimeCatalogSchema,
  dockerRuntimeEventSchema,
  dockerRuntimeEventSourceSchema,
  dockerStackSchema,
  dockerVolumeSchema,
  type DockerContainer,
  type DockerContainerLinkPath,
  type DockerContainerWithLinks,
  type DockerContainerInspectDetail,
  type DockerImageSecurityScanEvent,
  type DockerImageLayerEfficiency,
  type DockerImageScannerResult,
  type DockerImage,
  type DockerImageInspectDetail,
  type DockerNetwork,
  type DockerRuntimeCatalog,
  type DockerRuntimeActivityEntity,
  type DockerRuntimeEvent,
  type DockerStack,
  type DockerVulnerabilityEntry,
  type DockerVolume,
} from "@repo/contracts-entities";

interface ParsedFilterEntry { operator: string; value: unknown }

type ContractFilterKeys<TInput> = Extract<
  keyof NonNullable<TInput extends { filter?: infer TFilter } ? TFilter : never>,
  string
>;

interface PaginatedListInput {
  limit: number;
  offset: number;
}

interface SortableListInput {
  sortBy?: string;
  sortDirection?: "asc" | "desc";
}

interface DeploymentContext {
  deploymentId: string;
  serviceId: string;
  projectId: string;
  environment: string;
}

interface ResolvedContainerOwnership {
  managedBy: DockerContainer["managedBy"];
  managedReason: string | null;
  managedDeploymentId: string | null;
  managedServiceId: string | null;
  managedProjectId: string | null;
  managedImageRef: string | null;
  managedNetworkMode: string | null;
  logsStreamId: string | null;
}

type DockerRoleTier = "admin" | "developer" | "viewer";

interface ContainerLinkedDeploymentRecord {
  id: string;
  serviceId: string;
  projectId: string;
  environment: string;
  status: string;
  containerName: string | null;
  containerImage: string | null;
  domainUrl: string | null;
  healthCheckUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ContainerLinkedServiceRecord {
  id: string;
  projectId: string;
  name: string;
  type: string;
  isActive: boolean;
  updatedAt: Date;
  customDomains: unknown;
  resourceLimits: unknown;
  environmentVariables: unknown;
}

interface ContainerLinkedProjectRecord {
  id: string;
  name: string;
  baseDomain: string | null;
  updatedAt: Date;
}

interface ContainerHashInput {
  managedBy: DockerContainer["managedBy"];
  managedDeploymentId: string | null;
  managedServiceId: string | null;
  managedProjectId: string | null;
  projectId: string;
  serviceId: string;
  name: string;
  imageId: string | null;
  environment: string | null;
  ports: { containerPort: number; hostPort: number | null; protocol: "tcp" | "udp" }[];
}

const DOCKER_CONTAINER_STATUSES: DockerContainer["status"][] = [
  "created",
  "running",
  "paused",
  "restarting",
  "exited",
  "dead",
  "unknown",
];

const DOCKER_CONTAINER_HEALTH_STATUSES: DockerContainer["health"][] = [
  "healthy",
  "unhealthy",
  "starting",
  "none",
];

const DOCKER_NETWORK_DRIVERS: DockerNetwork["driver"][] = [
  "bridge",
  "overlay",
  "host",
  "macvlan",
  "ipvlan",
  "custom",
];

const DOCKER_NETWORK_SCOPES: DockerNetwork["scope"][] = [
  "local",
  "swarm",
  "global",
];

const DEPLOYMENT_ENVIRONMENT_ALIASES: Record<string, DockerContainer["environment"]> = {
  production: "production",
  prod: "production",
  staging: "staging",
  stage: "staging",
  preview: "preview",
  pr: "preview",
  development: "development",
  dev: "development",
};

const VULNERABILITY_SCAN_TIMEOUT_MS = 120_000;
const VULNERABILITY_LOG_POLL_INTERVAL_MS = 500;
const VULNERABILITY_LOG_TAIL = 10_000;
const DEFAULT_IMAGE_SCAN_SCANNER_PARALLELISM = 3;

interface ResolvedImageSecurityScan {
  vulnerabilities: DockerImageInspectDetail["vulnerabilities"];
  scanSummary: DockerImageInspectDetail["scanSummary"];
}

interface DockerImageLifecycleRecord {
  imageIdentifierNormalized: string;
  currentGeneration: number;
  lifecycleState: "alive" | "deleted";
}

interface DockerImageLifecycleUpsertResult {
  imageIdentifierNormalized: string;
  imageGeneration: number;
  revived: boolean;
}

interface RawImageSecurityScan {
  vulnerabilities: DockerImageInspectDetail["vulnerabilities"];
  scanSummary: Omit<NonNullable<DockerImageInspectDetail["scanSummary"]>, "cached">;
}

interface ScannerRunResult {
  vulnerabilities: DockerVulnerabilityEntry[];
  scannerResult: DockerImageScannerResult;
  layerEfficiency: DockerImageLayerEfficiency | null;
}

interface ScannerRunProgressOptions {
  logPollIntervalMs?: number;
  onEvent?: (event: DockerImageSecurityScanEvent) => void;
  imageId?: string;
}

interface ScannerExecutionResult {
  scanner: "trivy" | "grype" | "dive";
  exitCode: number;
  output: string;
  durationMs: number;
  executedAt: string;
}

interface ScannerExecutionConfig {
  scanner: "trivy" | "grype" | "dive";
  image: string;
  command: string[];
}

interface ScannerExecutionProgressOptions {
  logPollIntervalMs?: number;
  onLogLine?: (line: string) => void;
  onPullLogLine?: (line: string) => void;
}

interface BuildScanEventInput {
  imageId: string;
  type: DockerImageSecurityScanEvent["type"];
  stage: DockerImageSecurityScanEvent["stage"];
  scanner: DockerImageSecurityScanEvent["scanner"];
  message: string;
  progress: DockerImageSecurityScanEvent["progress"];
  logLine: DockerImageSecurityScanEvent["logLine"];
  scannerResult?: DockerImageSecurityScanEvent["scannerResult"];
  scanSummary?: DockerImageSecurityScanEvent["scanSummary"];
  vulnerabilities?: DockerImageSecurityScanEvent["vulnerabilities"];
}

@Injectable()
export class DockerRepository {
  private readonly logger = new Logger(DockerRepository.name);
  private localDockerDaemonId: string | null | undefined;
  private localDockerDaemonIdLoadPromise: Promise<string | null> | null = null;
  private readonly imageVulnerabilityScansInFlight = new Map<string, Promise<RawImageSecurityScan>>();
  private hasWarnedMissingSecurityScanTable = false;

  constructor(
    private readonly dockerService: DockerService,
    private readonly scannerContainerManager: ScannerContainerManagerService,
    private readonly globalDatabaseService: GlobalDatabaseService,
  ) {}

  async getLocalDockerDaemonId(): Promise<string | null> {
    if (typeof this.localDockerDaemonId !== "undefined") {
      return this.localDockerDaemonId;
    }

    if (this.localDockerDaemonIdLoadPromise) {
      return this.localDockerDaemonIdLoadPromise;
    }

    this.localDockerDaemonIdLoadPromise = (async () => {
      try {
        const dockerInfo = await this.dockerService.getDockerClient().info();
        const daemonId = typeof dockerInfo.ID === "string" && dockerInfo.ID.trim().length > 0
          ? dockerInfo.ID.trim()
          : null;

        this.localDockerDaemonId = daemonId;
        return daemonId;
      } catch {
        this.localDockerDaemonId = null;
        return null;
      } finally {
        this.localDockerDaemonIdLoadPromise = null;
      }
    })();

    return this.localDockerDaemonIdLoadPromise;
  }

  private getFilterEntry<
    TInput extends { filter?: unknown },
    TKey extends ContractFilterKeys<TInput>,
  >(input: TInput, key: TKey): ParsedFilterEntry | undefined {
    const filter = input.filter;
    if (!filter || typeof filter !== "object") {
      return undefined;
    }

    const rawEntry = (filter as Record<string, unknown>)[key];
    if (!rawEntry || typeof rawEntry !== "object") {
      return undefined;
    }

    const operator = (rawEntry as { operator?: unknown }).operator;
    if (typeof operator !== "string") {
      return undefined;
    }

    return {
      operator,
      value: (rawEntry as { value?: unknown }).value,
    };
  }

  private matchString(value: string, entry: ParsedFilterEntry | undefined): boolean {
    if (!entry) return true;
    const target = String(entry.value ?? "");

    switch (entry.operator) {
      case "eq":
        return value === target;
      case "like":
      case "ilike":
        return value.toLowerCase().includes(target.toLowerCase());
      default:
        return true;
    }
  }

  private matchEq(value: string | boolean, entry: ParsedFilterEntry | undefined): boolean {
    if (!entry) return true;
    if (entry.operator !== "eq") return true;

    if (typeof value === "boolean") {
      const expected =
        typeof entry.value === "boolean"
          ? entry.value
          : String(entry.value).toLowerCase() === "true";
      return value === expected;
    }

    return value === String(entry.value ?? "");
  }

  private matchNullableStringEq(value: string | null, entry: ParsedFilterEntry | undefined): boolean {
    if (!entry) return true;
    if (entry.operator !== "eq") return true;
    return value === String(entry.value ?? "");
  }

  private sortItems<T>(
    items: T[],
    input: SortableListInput,
    getComparableValue: (item: T, sortBy: string) => string | number,
  ): T[] {
    const sortBy = input.sortBy ?? "updatedAt";
    const direction = input.sortDirection === "asc" ? 1 : -1;

    return [...items].sort((a, b) => {
      const av = getComparableValue(a, sortBy);
      const bv = getComparableValue(b, sortBy);

      if (av < bv) return -1 * direction;
      if (av > bv) return 1 * direction;
      return 0;
    });
  }

  private paginate<T>(items: T[], input: PaginatedListInput) {
    const total = items.length;
    const data = items.slice(input.offset, input.offset + input.limit);
    return {
      data,
      meta: {
        total,
        limit: input.limit,
        offset: input.offset,
        hasMore: input.offset + input.limit < total,
      },
    };
  }

  private normalizeContainerStatus(state: string | undefined) {
    const normalized = (state ?? "unknown").toLowerCase();

    return DOCKER_CONTAINER_STATUSES.includes(normalized as DockerContainer["status"])
      ? (normalized as DockerContainer["status"])
      : "unknown";
  }

  private normalizeHealthStatus(status: string | undefined) {
    const normalized = (status ?? "none").toLowerCase();

    return DOCKER_CONTAINER_HEALTH_STATUSES.includes(normalized as DockerContainer["health"])
      ? (normalized as DockerContainer["health"])
      : "none";
  }

  private normalizeDeploymentEnvironment(value: string | null | undefined): DockerContainer["environment"] {
    if (!value) {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    return DEPLOYMENT_ENVIRONMENT_ALIASES[normalized] ?? null;
  }

  private parseEnvironmentFromContainerName(name: string): DockerContainer["environment"] {
    const segments = name
      .toLowerCase()
      .split(/[-_.]/g)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    for (const segment of segments) {
      const mapped = DEPLOYMENT_ENVIRONMENT_ALIASES[segment];
      if (mapped) {
        return mapped;
      }
    }

    return null;
  }

  private resolveContainerEnvironment(
    context: DeploymentContext | undefined,
    labels: Record<string, string>,
    name: string,
  ): DockerContainer["environment"] {
    const candidates = [
      context?.environment,
      labels["deployer.environment"],
      labels["deployer.env"],
      labels.environment,
      labels.env,
      labels.node_env,
      labels.app_env,
      this.parseEnvironmentFromContainerName(name),
    ];

    for (const candidate of candidates) {
      const normalized =
        typeof candidate === "string"
          ? this.normalizeDeploymentEnvironment(candidate)
          : (candidate ?? null);

      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private resolveContainerServiceId(
    context: DeploymentContext | undefined,
    labels: Record<string, string>,
    name: string,
    containerId: string,
  ): string {
    const candidates = [
      context?.serviceId,
      labels["deployer.service_id"],
      labels["com.docker.compose.service"],
      labels["com.docker.swarm.service.name"],
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    const nameSegments = name
      .split("-")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    if (nameSegments.length > 1) {
      const withoutReplica = /^\d+$/.test(nameSegments[nameSegments.length - 1] ?? "")
        ? nameSegments.slice(0, -1)
        : nameSegments;
      const inferred = withoutReplica.join("-");
      if (inferred.length > 0) {
        return inferred;
      }
    }

    return `service-${containerId.slice(0, 8)}`;
  }

  private resolveContainerProjectId(
    context: DeploymentContext | undefined,
    labels: Record<string, string>,
    serviceId: string,
    name: string,
  ): string {
    const candidates = [
      context?.projectId,
      labels["deployer.project_id"],
      labels["com.docker.compose.project"],
      labels["com.docker.stack.namespace"],
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    const firstSegment = name.split("-")[0]?.trim();
    if (firstSegment && firstSegment.length > 0) {
      return firstSegment;
    }

    return `project-${serviceId}`;
  }

  private async loadDeploymentContexts(deploymentIds: string[]): Promise<Map<string, DeploymentContext>> {
    if (deploymentIds.length === 0) {
      return new Map();
    }

    const rows = await this.globalDatabaseService.db
      .select({
        deploymentId: deployments.id,
        serviceId: deployments.serviceId,
        projectId: services.projectId,
        environment: deployments.environment,
      })
      .from(deployments)
      .innerJoin(services, eq(services.id, deployments.serviceId))
      .where(inArray(deployments.id, deploymentIds));

    return new Map(
      rows.map((row) => [
        row.deploymentId,
        {
          deploymentId: row.deploymentId,
          serviceId: row.serviceId,
          projectId: row.projectId,
          environment: row.environment,
        },
      ]),
    );
  }

  private resolveContainerOwnership(input: {
    labels: Record<string, string>;
    context: DeploymentContext | undefined;
    imageRef: string;
    networkMode: string | null;
  }): ResolvedContainerOwnership {
    const managedFlag = (input.labels["deployer.managed"] ?? "").trim().toLowerCase() === "true";

    const managedDeploymentId =
      input.context?.deploymentId
      ?? input.labels["deployer.deployment_id"]?.trim()
      ?? null;
    const managedServiceId =
      input.context?.serviceId
      ?? input.labels["deployer.service_id"]?.trim()
      ?? null;
    const managedProjectId =
      input.context?.projectId
      ?? input.labels["deployer.project_id"]?.trim()
      ?? null;

    const hasRequiredManagedTags =
      managedFlag
      && managedDeploymentId !== null
      && managedServiceId !== null
      && managedProjectId !== null;

    if (!hasRequiredManagedTags) {
      return {
        managedBy: "orphan",
        managedReason: managedFlag ? "missing_management_tags" : "unmanaged_runtime_container",
        managedDeploymentId,
        managedServiceId,
        managedProjectId,
        managedImageRef: null,
        managedNetworkMode: null,
        logsStreamId: null,
      };
    }

    return {
      managedBy: "deployment_service",
      managedReason: input.context ? "deployment_record_linked" : "deployment_labels_linked",
      managedDeploymentId,
      managedServiceId,
      managedProjectId,
      managedImageRef: input.imageRef,
      managedNetworkMode: input.networkMode,
      logsStreamId: managedDeploymentId,
    };
  }

  private extractHealthStatusFromContainerSummary(container: Record<string, unknown>): DockerContainer["health"] {
    const statusText = typeof container.Status === "string" ? container.Status.toLowerCase() : "";

    if (statusText.includes("(healthy)")) {
      return "healthy";
    }
    if (statusText.includes("(unhealthy)")) {
      return "unhealthy";
    }
    if (statusText.includes("(health: starting)") || statusText.includes("(starting)")) {
      return "starting";
    }

    return "none";
  }

  private normalizeNetworkDriver(driver: string | undefined): DockerNetwork["driver"] {
    const normalized = (driver ?? "custom").toLowerCase();

    return DOCKER_NETWORK_DRIVERS.includes(normalized as DockerNetwork["driver"])
      ? (normalized as DockerNetwork["driver"])
      : "custom";
  }

  private normalizeNetworkScope(scope: string | undefined): DockerNetwork["scope"] {
    const normalized = (scope ?? "global").toLowerCase();

    return DOCKER_NETWORK_SCOPES.includes(normalized as DockerNetwork["scope"])
      ? (normalized as DockerNetwork["scope"])
      : "global";
  }

  private buildContainerHash(input: ContainerHashInput): string {
    const identity = input.managedDeploymentId
      ? {
          kind: "deployment",
          managedBy: input.managedBy,
          deploymentId: input.managedDeploymentId,
        }
      : {
          kind: "runtime",
          managedBy: input.managedBy,
          projectId: input.managedProjectId ?? input.projectId,
          serviceId: input.managedServiceId ?? input.serviceId,
          name: input.name,
          imageId: input.imageId,
          environment: input.environment,
        };

    const payload = {
      identity,
      ports: [...input.ports]
        .map((port) => `${String(port.containerPort)}/${port.protocol}`)
        .sort(),
    };

    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  private parseRegistryAndRepository(repoTag: string): {
    registry: string;
    repository: string;
    tag: string | null;
  } {
    const normalizedRepoTag = repoTag.trim();
    const withoutDigest = normalizedRepoTag.includes("@")
      ? normalizedRepoTag.slice(0, normalizedRepoTag.indexOf("@"))
      : normalizedRepoTag;

    const lastSlashIndex = withoutDigest.lastIndexOf("/");
    const lastColonIndex = withoutDigest.lastIndexOf(":");
    const hasTagSuffix = lastColonIndex > lastSlashIndex;

    const namePart = hasTagSuffix ? withoutDigest.slice(0, lastColonIndex) : withoutDigest;
    const tagPart = hasTagSuffix ? withoutDigest.slice(lastColonIndex + 1) : null;

    const safeNamePart = namePart.length > 0 ? namePart : "library/unknown";
    const firstSegment = safeNamePart.split("/")[0] ?? "";
    const hasExplicitRegistry =
      firstSegment.includes(".") || firstSegment.includes(":") || firstSegment === "localhost";

    if (hasExplicitRegistry) {
      const [registry, ...repoParts] = safeNamePart.split("/");
      return {
        registry: this.normalizeImageRegistrySegment(registry),
        repository: this.normalizeImageRepositoryPath(repoParts.join("/")),
        tag: this.normalizeImageTag(tagPart),
      };
    }

    return {
      registry: "docker.io",
      repository: this.normalizeImageRepositoryPath(safeNamePart),
      tag: this.normalizeImageTag(tagPart),
    };
  }

  private resolvePrimaryImageTag(repoTags: string[], repoDigests: string[] = []): string | null {
    const tagCandidates = repoTags
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate.length > 0 && candidate !== "<none>:<none>");

    const digestCandidates = repoDigests
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate.length > 0 && candidate !== "<none>@<none>")
      .map((candidate) => {
        const digestSeparatorIndex = candidate.indexOf("@");
        return digestSeparatorIndex === -1 ? candidate : candidate.slice(0, digestSeparatorIndex);
      })
      .filter((candidate) => candidate.length > 0);

    const candidates = [...tagCandidates, ...digestCandidates];

    for (const candidate of candidates) {
      const parsed = this.parseRegistryAndRepository(candidate);
      if (parsed.repository !== "library/unknown") {
        return candidate;
      }
    }

    return candidates[0] ?? null;
  }

  private buildFallbackImageRepository(imageId: string): string {
    const normalizedId = imageId.replace(/^sha256:/, "").trim();
    const shortId = normalizedId.length > 0 ? normalizedId.slice(0, 12) : "unknown";
    return `untagged/${shortId}`;
  }

  private normalizeImageRegistrySegment(value: string | null | undefined): string {
    const normalized = (value ?? "").trim();
    if (normalized.length === 0 || normalized === "<none>" || this.isPlaceholderImageSegment(normalized)) {
      return "docker.io";
    }

    return normalized;
  }

  private normalizeImageRepositoryPath(value: string | null | undefined): string {
    const segments = (value ?? "")
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0 && segment !== "<none>" && !this.isPlaceholderImageSegment(segment));

    if (segments.length === 0) {
      return "library/unknown";
    }

    return segments.join("/");
  }

  private normalizeImageTag(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim();
    if (normalized.length === 0 || normalized === "<none>" || this.isPlaceholderImageSegment(normalized)) {
      return null;
    }

    return normalized;
  }

  private normalizeImageDigest(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim();
    if (normalized.length === 0 || normalized === "<none>" || this.isPlaceholderImageSegment(normalized)) {
      return null;
    }

    return normalized;
  }

  private isPlaceholderImageSegment(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized === "undefined" || normalized === "null" || normalized === "none" || normalized === "nan";
  }

  private resolveRoleTier(platformRole: string | null): DockerRoleTier {
    const normalized = (platformRole ?? "").trim().toLowerCase();

    if (["superadmin", "super_admin", "admin", "owner"].includes(normalized)) {
      return "admin";
    }

    if (["developer", "deployer", "maintainer"].includes(normalized)) {
      return "developer";
    }

    return "viewer";
  }

  private normalizeResourceLimits(
    value: unknown,
  ): { memory?: string; cpu?: string; storage?: string } | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const candidate = value as Record<string, unknown>;
    const memory = typeof candidate.memory === "string" ? candidate.memory : undefined;
    const cpu = typeof candidate.cpu === "string" ? candidate.cpu : undefined;
    const storage = typeof candidate.storage === "string" ? candidate.storage : undefined;

    if (!memory && !cpu && !storage) {
      return null;
    }

    return { memory, cpu, storage };
  }

  private normalizeEnvironmentVariables(value: unknown): Record<string, string> | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const entries = Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );

    if (entries.length === 0) {
      return null;
    }

    return Object.fromEntries(entries);
  }

  private normalizeCustomDomains(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }

  private shouldIncludeDeployment(includeSet: Set<DockerContainerLinkPath>): boolean {
    return (
      includeSet.has("deployment")
      || includeSet.has("deployment.service")
      || includeSet.has("deployment.service.project")
    );
  }

  private shouldIncludeService(includeSet: Set<DockerContainerLinkPath>): boolean {
    return (
      includeSet.has("service")
      || includeSet.has("service.project")
      || includeSet.has("deployment.service")
      || includeSet.has("deployment.service.project")
    );
  }

  private shouldIncludeProject(includeSet: Set<DockerContainerLinkPath>): boolean {
    return (
      includeSet.has("project")
      || includeSet.has("service.project")
      || includeSet.has("deployment.service.project")
    );
  }

  private projectLinkFromRecord(
    record: ContainerLinkedProjectRecord,
    roleTier: DockerRoleTier,
  ) {
    const redactedFields: string[] = [];
    let baseDomain = record.baseDomain;

    if (roleTier === "viewer") {
      redactedFields.push("baseDomain");
      baseDomain = null;
    }

    return dockerContainerLinkedProjectSchema.parse({
      id: record.id,
      name: record.name,
      baseDomain,
      updatedAt: record.updatedAt.toISOString(),
      redactedFields,
    });
  }

  private serviceLinkFromRecord(
    record: ContainerLinkedServiceRecord,
    roleTier: DockerRoleTier,
  ) {
    const redactedFields: string[] = [];
    let resourceLimits = this.normalizeResourceLimits(record.resourceLimits);
    let environmentVariables = this.normalizeEnvironmentVariables(record.environmentVariables);

    if (roleTier === "viewer") {
      if (resourceLimits) redactedFields.push("resourceLimits");
      if (environmentVariables) redactedFields.push("environmentVariables");
      resourceLimits = null;
      environmentVariables = null;
    }

    if (roleTier === "developer") {
      if (environmentVariables) redactedFields.push("environmentVariables");
      environmentVariables = null;
    }

    return dockerContainerLinkedServiceSchema.parse({
      id: record.id,
      projectId: record.projectId,
      name: record.name,
      type: record.type,
      isActive: record.isActive,
      updatedAt: record.updatedAt.toISOString(),
      customDomains: this.normalizeCustomDomains(record.customDomains),
      resourceLimits,
      environmentVariables,
      redactedFields,
    });
  }

  private deploymentLinkFromRecord(
    record: ContainerLinkedDeploymentRecord,
    roleTier: DockerRoleTier,
  ) {
    const redactedFields: string[] = [];
    let domainUrl = record.domainUrl;
    let healthCheckUrl = record.healthCheckUrl;

    if (roleTier === "viewer") {
      if (domainUrl) redactedFields.push("domainUrl");
      if (healthCheckUrl) redactedFields.push("healthCheckUrl");
      domainUrl = null;
      healthCheckUrl = null;
    }

    if (roleTier === "developer" && record.environment === "production") {
      if (domainUrl) redactedFields.push("domainUrl");
      if (healthCheckUrl) redactedFields.push("healthCheckUrl");
      domainUrl = null;
      healthCheckUrl = null;
    }

    return dockerContainerLinkedDeploymentSchema.parse({
      id: record.id,
      serviceId: record.serviceId,
      projectId: record.projectId,
      environment: record.environment,
      status: record.status,
      containerName: record.containerName,
      containerImage: record.containerImage,
      domainUrl,
      healthCheckUrl,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      redactedFields,
    });
  }

  async attachContainerLinks(
    containers: DockerContainer[],
    includePaths: DockerContainerLinkPath[],
    platformRole: string | null,
  ): Promise<DockerContainerWithLinks[]> {
    if (containers.length === 0) {
      return [];
    }

    const includeSet = new Set(includePaths);
    const includeDeployment = this.shouldIncludeDeployment(includeSet);
    const includeService = this.shouldIncludeService(includeSet);
    const includeProject = this.shouldIncludeProject(includeSet);

    if (!includeDeployment && !includeService && !includeProject) {
      return containers.map((container) =>
        dockerContainerWithLinksSchema.parse({
          ...container,
          links: {
            deployment: null,
            service: null,
            project: null,
          },
        }),
      );
    }

    const roleTier = this.resolveRoleTier(platformRole);

    const deploymentIdSet = new Set<string>();
    const serviceIdSet = new Set<string>();
    const projectIdSet = new Set<string>();

    for (const container of containers) {
      if (includeDeployment && container.logsStreamId) {
        deploymentIdSet.add(container.logsStreamId);
      }

      if (includeService && container.serviceId) {
        serviceIdSet.add(container.serviceId);
      }

      if (includeProject && container.projectId) {
        projectIdSet.add(container.projectId);
      }
    }

    const deploymentIds = [...deploymentIdSet];
    const deploymentRows: ContainerLinkedDeploymentRecord[] =
      deploymentIds.length === 0
        ? []
        : await this.globalDatabaseService.db
            .select({
              id: deployments.id,
              serviceId: deployments.serviceId,
              projectId: services.projectId,
              environment: deployments.environment,
              status: deployments.status,
              containerName: deployments.containerName,
              containerImage: deployments.containerImage,
              domainUrl: deployments.domainUrl,
              healthCheckUrl: deployments.healthCheckUrl,
              createdAt: deployments.createdAt,
              updatedAt: deployments.updatedAt,
            })
            .from(deployments)
            .innerJoin(services, eq(services.id, deployments.serviceId))
            .where(inArray(deployments.id, deploymentIds));

    const deploymentsById = new Map(deploymentRows.map((row) => [row.id, row]));

    if (includeService) {
      for (const deploymentRow of deploymentRows) {
        serviceIdSet.add(deploymentRow.serviceId);
      }
    }

    if (includeProject) {
      for (const deploymentRow of deploymentRows) {
        projectIdSet.add(deploymentRow.projectId);
      }
    }

    const serviceIds = [...serviceIdSet];
    const serviceRows: ContainerLinkedServiceRecord[] =
      serviceIds.length === 0
        ? []
        : await this.globalDatabaseService.db
            .select({
              id: services.id,
              projectId: services.projectId,
              name: services.name,
              type: services.type,
              isActive: services.isActive,
              updatedAt: services.updatedAt,
              customDomains: services.customDomains,
              resourceLimits: services.resourceLimits,
              environmentVariables: services.environmentVariables,
            })
            .from(services)
            .where(inArray(services.id, serviceIds));

    const servicesById = new Map(serviceRows.map((row) => [row.id, row]));

    if (includeProject) {
      for (const serviceRow of serviceRows) {
        projectIdSet.add(serviceRow.projectId);
      }
    }

    const projectIds = [...projectIdSet];
    const projectRows: ContainerLinkedProjectRecord[] =
      projectIds.length === 0
        ? []
        : await this.globalDatabaseService.db
            .select({
              id: projects.id,
              name: projects.name,
              baseDomain: projects.baseDomain,
              updatedAt: projects.updatedAt,
            })
            .from(projects)
            .where(inArray(projects.id, projectIds));

    const projectsById = new Map(projectRows.map((row) => [row.id, row]));

    return containers.map((container) => {
      const deploymentRecord =
        includeDeployment && container.logsStreamId
          ? deploymentsById.get(container.logsStreamId)
          : undefined;

      const serviceRecord = includeService
        ? (
            servicesById.get(container.serviceId)
            ?? (deploymentRecord ? servicesById.get(deploymentRecord.serviceId) : undefined)
          )
        : undefined;

      const projectRecord = includeProject
        ? (
            projectsById.get(container.projectId)
            ?? (serviceRecord ? projectsById.get(serviceRecord.projectId) : undefined)
            ?? (deploymentRecord ? projectsById.get(deploymentRecord.projectId) : undefined)
          )
        : undefined;

      return dockerContainerWithLinksSchema.parse({
        ...container,
        links: {
          deployment: deploymentRecord
            ? this.deploymentLinkFromRecord(deploymentRecord, roleTier)
            : null,
          service: serviceRecord
            ? this.serviceLinkFromRecord(serviceRecord, roleTier)
            : null,
          project: projectRecord
            ? this.projectLinkFromRecord(projectRecord, roleTier)
            : null,
        },
      });
    });
  }

  private async listRawContainers() {
    const docker = this.dockerService.getDockerClient();
    return (await docker.listContainers({ all: true })) as unknown as Record<string, unknown>[];
  }

  async listContainers(input: DockerContainerListInput) {
    const rawContainers = await this.listRawContainers();
    const deploymentIds = [...new Set(rawContainers
      .map((container) => {
        const labels = (container.Labels as Record<string, string> | undefined) ?? {};
        const deploymentId = labels["deployer.deployment_id"];
        return typeof deploymentId === "string" && deploymentId.trim().length > 0
          ? deploymentId.trim()
          : null;
      })
      .filter((deploymentId): deploymentId is string => deploymentId !== null))];
    const deploymentContextById = await this.loadDeploymentContexts(deploymentIds);

    const mapped = rawContainers.map((container) => {
      const labels = (container.Labels as Record<string, string> | undefined) ?? {};
      const deploymentIdLabel = labels["deployer.deployment_id"];
      const deploymentId =
        typeof deploymentIdLabel === "string" && deploymentIdLabel.trim().length > 0
          ? deploymentIdLabel.trim()
          : null;
      const context: DeploymentContext | undefined = deploymentId
        ? deploymentContextById.get(deploymentId)
        : undefined;

      const ports = ((container.Ports as Record<string, unknown>[] | undefined) ?? []).map((port) => {
        const protocol: "tcp" | "udp" = String(port.Type ?? "tcp") === "udp" ? "udp" : "tcp";

        return {
          containerPort: Number(port.PrivatePort ?? 0),
          hostPort: port.PublicPort == null ? null : Number(port.PublicPort),
          protocol,
        };
      });

      const networkIds = Object.keys(
        ((container.NetworkSettings as { Networks?: Record<string, unknown> } | undefined)?.Networks ?? {}),
      );

      const createdAt =
        typeof container.Created === "number"
          ? new Date(container.Created * 1000).toISOString()
          : new Date().toISOString();

      const name = String((container.Names as string[] | undefined)?.[0] ?? "").replace(/^\//, "") || String(container.Id ?? "unknown-container");

      const containerId = String(container.Id ?? "");
      const imageId =
        (typeof container.ImageID === "string" && container.ImageID.length > 0
          ? container.ImageID
          : null);
      const imageRef = typeof container.Image === "string" && container.Image.length > 0
        ? container.Image
        : "unknown-image";
      const environment = this.resolveContainerEnvironment(context, labels, name);
      const networkMode =
        (typeof labels["deployer.network_mode"] === "string" && labels["deployer.network_mode"].trim().length > 0
          ? labels["deployer.network_mode"].trim()
          : null)
        ?? (typeof (container.HostConfig as { NetworkMode?: unknown } | undefined)?.NetworkMode === "string"
          ? ((container.HostConfig as { NetworkMode?: string }).NetworkMode ?? null)
          : null);
      const volumeIds = ((container.Mounts as Record<string, unknown>[] | undefined) ?? [])
        .map((mount) => {
          if (typeof mount.Name === "string" && mount.Name.length > 0) {
            return mount.Name;
          }
          if (typeof mount.Source === "string" && mount.Source.length > 0) {
            return mount.Source;
          }
          return null;
        })
        .filter((value): value is string => value !== null);

      const ownership = this.resolveContainerOwnership({
        labels,
        context,
        imageRef,
        networkMode,
      });

      const serviceId = ownership.managedServiceId
        ?? this.resolveContainerServiceId(context, labels, name, containerId);
      const projectId = ownership.managedProjectId
        ?? this.resolveContainerProjectId(context, labels, serviceId, name);

      const stateText = typeof container.State === "string" ? container.State : undefined;

      const hash = this.buildContainerHash({
        managedBy: ownership.managedBy,
        managedDeploymentId: ownership.managedDeploymentId,
        managedServiceId: ownership.managedServiceId,
        managedProjectId: ownership.managedProjectId,
        projectId,
        serviceId,
        name,
        imageId,
        environment,
        ports,
      });

      return dockerContainerSchema.parse({
        id: containerId,
        hash,
        name,
        projectId,
        serviceId,
        stackId: labels["com.docker.compose.project"] ?? labels["com.docker.stack.namespace"] ?? null,
        imageId,
        status: this.normalizeContainerStatus(stateText),
        health: this.extractHealthStatusFromContainerSummary(container),
        environment,
        cpuPercent: null,
        memoryPercent: null,
        restartCount: 0,
        ports,
        networkIds,
        volumeIds,
        managedBy: ownership.managedBy,
        managedReason: ownership.managedReason,
        managedDeploymentId: ownership.managedDeploymentId,
        managedServiceId: ownership.managedServiceId,
        managedProjectId: ownership.managedProjectId,
        managedImageRef: ownership.managedImageRef,
        managedNetworkMode: ownership.managedNetworkMode,
        logsStreamId: ownership.logsStreamId,
        startedAt: null,
        createdAt,
        updatedAt: new Date().toISOString(),
      });
    });

    const filtered = mapped.filter((item) => {
      const nameMatch = this.matchString(item.name, this.getFilterEntry(input, "name"));
      const statusMatch = this.matchEq(item.status, this.getFilterEntry(input, "status"));
      const projectMatch = this.matchEq(item.projectId, this.getFilterEntry(input, "projectId"));
      const serviceMatch = this.matchEq(item.serviceId, this.getFilterEntry(input, "serviceId"));
      const managedByMatch = this.matchEq(item.managedBy, this.getFilterEntry(input, "managedBy"));
      const managedDeploymentMatch = this.matchNullableStringEq(
        item.managedDeploymentId,
        this.getFilterEntry(input, "managedDeploymentId"),
      );
      const managedServiceMatch = this.matchNullableStringEq(
        item.managedServiceId,
        this.getFilterEntry(input, "managedServiceId"),
      );
      const managedProjectMatch = this.matchNullableStringEq(
        item.managedProjectId,
        this.getFilterEntry(input, "managedProjectId"),
      );

      return (
        nameMatch
        && statusMatch
        && projectMatch
        && serviceMatch
        && managedByMatch
        && managedDeploymentMatch
        && managedServiceMatch
        && managedProjectMatch
      );
    });

    const sorted = this.sortItems(filtered, input, (item, sortBy) => {
      switch (sortBy) {
        case "name":
          return item.name;
        case "status":
          return item.status;
        case "createdAt":
          return item.createdAt;
        case "updatedAt":
          return item.updatedAt;
        default:
          return item.updatedAt;
      }
    });

    return this.paginate(sorted, input);
  }

  private toStringArray(value: string | string[] | undefined | null): string[] {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    }

    if (typeof value === "string" && value.length > 0) {
      return [value];
    }

    return [];
  }

  private extractRootFsLayers(source: unknown): string[] {
    if (!source || typeof source !== "object") {
      return [];
    }

    const record = source as Record<string, unknown>;

    const rootFsCandidate = (() => {
      const upper = record.RootFS;
      if (upper && typeof upper === "object") {
        return upper as Record<string, unknown>;
      }

      const lower = record.RootFs;
      if (lower && typeof lower === "object") {
        return lower as Record<string, unknown>;
      }

      return null;
    })();

    if (!rootFsCandidate) {
      return [];
    }

    const layersValue = rootFsCandidate.Layers ?? rootFsCandidate.layers;
    if (Array.isArray(layersValue)) {
      return layersValue.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    }

    if (typeof layersValue === "string" && layersValue.length > 0) {
      return [layersValue];
    }

    return [];
  }

  private detectWatchModeFromLabels(labels: Record<string, string>):
    DockerContainerInspectDetail["runtimeConfig"]["watchMode"] {
    const normalizedValues = Object.values(labels).map((value) => value.toLowerCase());
    const normalizedKeys = Object.keys(labels).map((key) => key.toLowerCase());

    const has = (needle: string) =>
      normalizedValues.some((value) => value.includes(needle))
      || normalizedKeys.some((value) => value.includes(needle));

    if (has("nodemon")) return "nodemon";
    if (has("watchpack")) return "watchpack";
    if (has("vite")) return "vite";
    if (has("turbo")) return "turbo";
    if (has("watch")) return "custom";

    return "disabled";
  }

  private toHealthcheckSeconds(value: number | undefined): number | null {
    if (typeof value !== "number" || value <= 0) {
      return null;
    }

    return Math.max(1, Math.round(value / 1_000_000_000));
  }

  async inspectContainer(containerId: string) {
    let inspect: Awaited<ReturnType<DockerService["getContainerInfo"]>>;
    try {
      inspect = await this.dockerService.getContainerInfo(containerId);
    } catch {
      throw new NotFoundException(`Container '${containerId}' not found`);
    }

    const generatedAt = new Date().toISOString();
    const labels = inspect.Config?.Labels ?? {};
    const envEntries = this.toStringArray(inspect.Config?.Env);
    const healthcheckTest = this.toStringArray(inspect.Config?.Healthcheck?.Test);
    const healthcheckCommand =
      healthcheckTest.length > 1
        ? healthcheckTest.slice(1).join(" ")
        : (healthcheckTest[0] ?? null);

    const networkConfig = Object.entries(inspect.NetworkSettings?.Networks ?? {}).map(
      ([networkName, networkAttachment]) => ({
        networkId: networkAttachment.NetworkID || networkName,
        name: networkName,
        driver: "custom" as const,
        scope: "global" as const,
        ipv4: networkAttachment.IPAddress || null,
        ipv6: networkAttachment.GlobalIPv6Address || null,
        gateway: networkAttachment.Gateway || null,
        macAddress: networkAttachment.MacAddress || null,
        aliases: this.toStringArray(networkAttachment.Aliases),
        dnsServers: this.toStringArray(inspect.HostConfig?.Dns),
        dnsSearch: this.toStringArray(inspect.HostConfig?.DnsSearch),
        dnsOptions: this.toStringArray(inspect.HostConfig?.DnsOptions),
        extraHosts: this.toStringArray(inspect.HostConfig?.ExtraHosts),
      }),
    );

    const portMappings = Object.entries(inspect.NetworkSettings?.Ports ?? {}).flatMap(
      ([containerPortWithProtocol, hostBindings]) => {
        const [containerPortRaw, protocolRaw] = containerPortWithProtocol.split("/");
        const containerPort = Number(containerPortRaw);
        const protocol = protocolRaw === "udp" ? "udp" : "tcp";

        if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
          return [];
        }

        if (!hostBindings || hostBindings.length === 0) {
          return [
            {
              containerPort,
              hostIp: "0.0.0.0",
              hostPort: null,
              protocol,
              url: null,
            },
          ];
        }

        return hostBindings.map((binding) => {
          const hostIp = binding.HostIp || "0.0.0.0";
          const hostPort = binding.HostPort ? Number(binding.HostPort) : null;
          const url =
            protocol === "tcp" && hostPort !== null
              ? `http://${hostIp === "0.0.0.0" ? "localhost" : hostIp}:${String(hostPort)}`
              : null;

          return {
            containerPort,
            hostIp,
            hostPort,
            protocol,
            url,
          };
        });
      },
    );

    const mounts = inspect.Mounts.map((mount) => ({
      type:
        mount.Type === "bind" || mount.Type === "volume" || mount.Type === "tmpfs" || mount.Type === "npipe"
          ? mount.Type
          : "bind",
      mountName: mount.Name || null,
      source: mount.Source || "",
      target: mount.Destination || "",
      readOnly: !mount.RW,
      propagation: mount.Propagation || null,
      mode: mount.Mode || null,
      sizeBytes: null,
    }));

    const environment = envEntries.map((entry) => {
      const [key, ...valueParts] = entry.split("=");
      const normalizedKey = (key ?? "").trim();
      const value = valueParts.join("=");
      const isSecretKey = /(password|secret|token|key)/i.test(normalizedKey);

      return {
        key: normalizedKey,
        value,
        masked: isSecretKey,
        source: isSecretKey ? ("secret" as const) : ("runtime" as const),
      };
    });

    const runtimeConfig = {
      user: inspect.Config?.User || null,
      workingDir: inspect.Config?.WorkingDir || null,
      entrypoint: this.toStringArray(inspect.Config?.Entrypoint),
      command: this.toStringArray(inspect.Config?.Cmd),
      restartPolicy: inspect.HostConfig?.RestartPolicy?.Name || "no",
      restartMaxRetries:
        typeof inspect.HostConfig?.RestartPolicy?.MaximumRetryCount === "number"
        && inspect.HostConfig.RestartPolicy.MaximumRetryCount > 0
          ? inspect.HostConfig.RestartPolicy.MaximumRetryCount
          : null,
      privileged: Boolean(inspect.HostConfig?.Privileged),
      readOnlyRootFs: Boolean(inspect.HostConfig?.ReadonlyRootfs),
      oomKillDisable: Boolean(inspect.HostConfig?.OomKillDisable),
      ipcMode: inspect.HostConfig?.IpcMode || null,
      pidMode: inspect.HostConfig?.PidMode || null,
      networkMode: inspect.HostConfig?.NetworkMode || null,
      cgroupnsMode:
        (inspect.HostConfig as Record<string, unknown> | undefined)?.CgroupnsMode &&
        typeof (inspect.HostConfig as Record<string, unknown>).CgroupnsMode === "string"
          ? ((inspect.HostConfig as Record<string, unknown>).CgroupnsMode as string)
          : null,
      watchMode: this.detectWatchModeFromLabels(labels),
      healthcheckCommand,
      healthcheckIntervalSec: this.toHealthcheckSeconds(inspect.Config?.Healthcheck?.Interval),
      healthcheckTimeoutSec: this.toHealthcheckSeconds(inspect.Config?.Healthcheck?.Timeout),
      healthcheckRetries: inspect.Config?.Healthcheck?.Retries ?? null,
    };

    const composeServiceName = labels["com.docker.compose.service"]
      || labels["com.docker.swarm.service.name"]
      || null;
    const composeProjectName = labels["com.docker.compose.project"]
      || labels["com.docker.stack.namespace"]
      || null;
    const composeConfigPath = labels["com.docker.compose.project.config_files"] ?? null;
    const composeDependsOnRaw = labels["com.docker.compose.depends_on"] ?? "";
    const composeDependsOn = composeDependsOnRaw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => ({
        service: entry,
        condition: "service_started" as const,
        required: true,
      }));

    const composeConfig = composeServiceName || composeProjectName
      ? {
          serviceName: composeServiceName,
          projectName: composeProjectName,
          composeFilePath: composeConfigPath,
          dependsOn: composeDependsOn,
          dns: this.toStringArray(inspect.HostConfig?.Dns),
          dnsSearch: this.toStringArray(inspect.HostConfig?.DnsSearch),
          dnsOptions: this.toStringArray(inspect.HostConfig?.DnsOptions),
          memLimitMb:
            typeof inspect.HostConfig?.Memory === "number" && inspect.HostConfig.Memory > 0
              ? Math.round(inspect.HostConfig.Memory / (1024 * 1024))
              : null,
          memReservationMb:
            typeof inspect.HostConfig?.MemoryReservation === "number" && inspect.HostConfig.MemoryReservation > 0
              ? Math.round(inspect.HostConfig.MemoryReservation / (1024 * 1024))
              : null,
          cpus:
            typeof inspect.HostConfig?.NanoCpus === "number" && inspect.HostConfig.NanoCpus > 0
              ? Number((inspect.HostConfig.NanoCpus / 1_000_000_000).toFixed(2))
              : null,
          cpuShares:
            typeof inspect.HostConfig?.CpuShares === "number" && inspect.HostConfig.CpuShares > 0
              ? inspect.HostConfig.CpuShares
              : null,
          restart: inspect.HostConfig?.RestartPolicy?.Name || null,
          profiles: labels["com.docker.compose.project.working_dir"] ? ["default"] : [],
          ports: Object.keys(inspect.Config?.ExposedPorts ?? {}),
          volumes: Object.keys(inspect.Config?.Volumes ?? {}),
          labels,
          rawYaml: [
            "services:",
            `  ${composeServiceName ?? "service"}:`,
            `    image: ${inspect.Config?.Image ?? "unknown"}`,
            `    restart: ${inspect.HostConfig?.RestartPolicy?.Name ?? "no"}`,
            ...Object.keys(inspect.Config?.ExposedPorts ?? {}).map((port) => `    # exposed: ${port}`),
          ].join("\n"),
        }
      : null;

    let layerIds = this.extractRootFsLayers(inspect);

    if (layerIds.length === 0) {
      const imageCandidates = [inspect.Image, inspect.Config?.Image]
        .filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
        .map((candidate) => candidate.trim());

      for (const imageCandidate of imageCandidates) {
        try {
          const imageInspect = await this.dockerService.getDockerClient().getImage(imageCandidate).inspect();
          layerIds = this.extractRootFsLayers(imageInspect);
          if (layerIds.length > 0) {
            break;
          }
        } catch {
          // Ignore image inspect fallback errors and keep empty layers.
        }
      }
    }

    const layers = layerIds.map((layerId, index) => ({
      id: layerId,
      instruction: `LAYER ${String(index + 1)}`,
      size: "unknown",
      createdAt: generatedAt,
    }));

    return dockerContainerInspectDetailSchema.parse({
      containerId,
      generatedAt,
      layers,
      processes: [],
      streamingLogsSupported: true,
      networkConfig,
      portMappings,
      mounts,
      environment,
      runtimeConfig,
      composeConfig,
    });
  }

  async inspectImage(imageId: string) {
    const inspect = await this.inspectImageWithCandidates(imageId);

    const generatedAt = new Date().toISOString();
    const inspectId = typeof inspect.Id === "string" && inspect.Id.length > 0 ? inspect.Id : imageId;
    const repoTags = this
      .toStringArray(inspect.RepoTags as string | string[] | undefined)
      .filter((tag) => tag !== "<none>:<none>");
    const repoDigests = this.toStringArray(inspect.RepoDigests as string | string[] | undefined);
    const resolvedPrimaryTag = this.resolvePrimaryImageTag(repoTags, repoDigests);
    const fallbackRepository = this.buildFallbackImageRepository(inspectId);
    const fallbackRegistry = "local";
    const primaryTag = resolvedPrimaryTag ?? `${fallbackRegistry}/${fallbackRepository}`;
    const parsedPrimary = resolvedPrimaryTag
      ? this.parseRegistryAndRepository(primaryTag)
      : { registry: fallbackRegistry, repository: fallbackRepository, tag: null };
    const repository = parsedPrimary.repository === "library/unknown"
      ? fallbackRepository
      : parsedPrimary.repository;
    const labels =
      typeof inspect.Config === "object"
      && inspect.Config !== null
      && typeof (inspect.Config as Record<string, unknown>).Labels === "object"
      && (inspect.Config as Record<string, unknown>).Labels !== null
        ? ((inspect.Config as Record<string, unknown>).Labels as Record<string, string>)
        : {};

    const rootFs =
      typeof inspect.RootFS === "object" && inspect.RootFS !== null
        ? (inspect.RootFS as Record<string, unknown>)
        : {};

    const config =
      typeof inspect.Config === "object" && inspect.Config !== null
        ? (inspect.Config as Record<string, unknown>)
        : {};

    const createdAt =
      typeof inspect.Created === "string" && !Number.isNaN(Date.parse(inspect.Created))
        ? new Date(inspect.Created).toISOString()
        : generatedAt;

    const layers = this.toStringArray(rootFs.Layers as string | string[] | undefined).map((layerId, index) => ({
      id: layerId,
      instruction: `LAYER ${String(index + 1)}`,
      size: "unknown",
      createdAt,
    }));

    const rawContainers = await this.listRawContainers();
    const usedByContainerIds = rawContainers
      .filter((container) => {
        const containerImageId = typeof container.ImageID === "string" ? container.ImageID : "";
        const containerImageName = typeof container.Image === "string" ? container.Image : "";

        if (containerImageId.length > 0 && containerImageId === inspectId) {
          return true;
        }

        return repoTags.includes(containerImageName);
      })
      .map((container) => String(container.Id ?? ""))
      .filter((id) => id.length > 0);

    const vulnerabilityScanTargets = [inspectId, ...repoTags]
      .map((candidate) => candidate.trim())
      .filter((candidate, index, all) => candidate.length > 0 && all.indexOf(candidate) === index);

    const securityScan = await this.resolveImageVulnerabilities(inspectId, vulnerabilityScanTargets, {
      allowFreshScan: false,
    });

    return dockerImageInspectDetailSchema.parse({
      imageId: inspectId,
      generatedAt,
      registry: parsedPrimary.registry,
      repository,
      tag: parsedPrimary.tag,
      digest: this.normalizeImageDigest(repoDigests[0] ?? null),
      sizeBytes: typeof inspect.Size === "number" ? inspect.Size : null,
      createdAt,
      lastSeenAt: generatedAt,
      labels,
      architecture: typeof inspect.Architecture === "string" ? inspect.Architecture : null,
      os: typeof inspect.Os === "string" ? inspect.Os : null,
      variant: typeof inspect.Variant === "string" ? inspect.Variant : null,
      author: typeof inspect.Author === "string" ? inspect.Author : null,
      comment: typeof inspect.Comment === "string" ? inspect.Comment : null,
      dockerVersion: typeof inspect.DockerVersion === "string" ? inspect.DockerVersion : null,
      rootFsType: typeof rootFs.Type === "string" ? rootFs.Type : null,
      repoTags,
      repoDigests,
      layers,
      vulnerabilities: securityScan.vulnerabilities,
      scanSummary: securityScan.scanSummary ?? null,
      usedByContainerIds: [...new Set(usedByContainerIds)],
      runtimeConfig: {
        env: this.toStringArray(config.Env as string | string[] | undefined),
        exposedPorts:
          typeof config.ExposedPorts === "object" && config.ExposedPorts !== null
            ? Object.keys(config.ExposedPorts)
            : [],
        workingDir: typeof config.WorkingDir === "string" ? config.WorkingDir : null,
        user: typeof config.User === "string" && config.User.length > 0 ? config.User : null,
        entrypoint: this.toStringArray(config.Entrypoint as string | string[] | undefined),
        command: this.toStringArray(config.Cmd as string | string[] | undefined),
      },
    });
  }

  async streamImageSecurityScan(
    imageId: string,
    options: ScannerRunProgressOptions = {},
  ): Promise<ResolvedImageSecurityScan> {
    const inspect = await this.inspectImageWithCandidates(imageId);

    const inspectId = typeof inspect.Id === "string" && inspect.Id.length > 0 ? inspect.Id : imageId;
    const repoTags = this
      .toStringArray(inspect.RepoTags as string | string[] | undefined)
      .filter((tag) => tag !== "<none>:<none>");

    const scanTargets = [inspectId, ...repoTags]
      .map((candidate) => candidate.trim())
      .filter((candidate, index, all) => candidate.length > 0 && all.indexOf(candidate) === index);

    options.onEvent?.(this.buildScanEvent({
      imageId: inspectId,
      type: "status",
      stage: "queued",
      scanner: null,
      progress: 0,
      message: "Queued security scan",
      logLine: null,
    }));

    const scanResult = await this.scanImageVulnerabilitiesWithProgress(
      inspectId,
      scanTargets,
      options,
    );
    await this.persistImageSecurityScan(inspectId, scanResult);

    return {
      vulnerabilities: scanResult.vulnerabilities,
      scanSummary: {
        ...scanResult.scanSummary,
        cached: false,
      },
    };
  }

  async getPersistedImageSecurityScan(
    imageId: string,
    options?: { maxAgeMs?: number | null },
  ): Promise<ResolvedImageSecurityScan | null> {
    const inspect = await this.inspectImageWithCandidates(imageId);

    const inspectId = typeof inspect.Id === "string" && inspect.Id.length > 0 ? inspect.Id : imageId;
    const repoTags = this
      .toStringArray(inspect.RepoTags as string | string[] | undefined)
      .filter((tag) => tag !== "<none>:<none>");

    const scanTargets = [inspectId, ...repoTags]
      .map((candidate) => candidate.trim())
      .filter((candidate, index, all) => candidate.length > 0 && all.indexOf(candidate) === index);

    const persisted = await this.readPersistedImageSecurityScan([inspectId, ...scanTargets]);
    if (!persisted) {
      return null;
    }

    const maxAgeMs = options?.maxAgeMs;
    if (typeof maxAgeMs === "number" && Number.isFinite(maxAgeMs)) {
      const scannedAtEpoch = Date.parse(persisted.scanSummary.scannedAt);
      if (Number.isFinite(scannedAtEpoch)) {
        const ageMs = Date.now() - scannedAtEpoch;
        if (ageMs > maxAgeMs) {
          return null;
        }
      }
    }

    return {
      vulnerabilities: persisted.vulnerabilities,
      scanSummary: {
        ...persisted.scanSummary,
        cached: true,
      },
    };
  }

  async ensureImageAutoScanEligibility(
    imageId: string,
    options: { maxAgeMs?: number } = {},
  ): Promise<{
    imageIdentifierNormalized: string;
    imageGeneration: number;
    shouldScan: boolean;
  }> {
    const lifecycle = await this.ensureImageLifecycleAlive(imageId);

    let existing: { id: string } | null = null;
    try {
      existing = await this.globalDatabaseService.db
        .select({ id: dockerImageSecurityScans.id })
        .from(dockerImageSecurityScans)
        .where(and(
          eq(dockerImageSecurityScans.imageIdentifierNormalized, lifecycle.imageIdentifierNormalized),
          eq(dockerImageSecurityScans.imageGeneration, lifecycle.imageGeneration),
        ))
        .limit(1)
        .then((rows) => rows[0] ?? null);
    } catch (error: unknown) {
      if (!this.isMissingDockerSecurityScanTableError(error)) {
        throw error;
      }

      this.warnMissingDockerSecurityScanTableOnce();
      existing = null;
    }

    const maxAgeMs = options.maxAgeMs;
    const isStale = await this.isImageGenerationScanStale(
      lifecycle.imageIdentifierNormalized,
      lifecycle.imageGeneration,
      maxAgeMs,
    );

    return {
      imageIdentifierNormalized: lifecycle.imageIdentifierNormalized,
      imageGeneration: lifecycle.imageGeneration,
      shouldScan: existing === null || isStale,
    };
  }

  async reconcileImageLifecycleWithActiveSet(activeImageIds: string[]): Promise<void> {
    const normalizedActiveCandidates = await Promise.all(
      activeImageIds.map((id) => this.resolveLifecycleIdentifier(id)),
    );
    const normalizedActive = [...new Set(
      normalizedActiveCandidates
        .map((resolved) => resolved.imageIdentifierNormalized)
        .filter((id) => id.length > 0),
    )];

    let aliveRows: { imageIdentifierNormalized: string }[] = [];

    try {
      aliveRows = await this.globalDatabaseService.db
        .select({ imageIdentifierNormalized: dockerImageSecurityLifecycle.imageIdentifierNormalized })
        .from(dockerImageSecurityLifecycle)
        .where(eq(dockerImageSecurityLifecycle.lifecycleState, "alive"));
    } catch (error: unknown) {
      if (!this.isMissingDockerSecurityScanTableError(error)) {
        throw error;
      }

      this.warnMissingDockerSecurityScanTableOnce();
      return;
    }

    const activeSet = new Set(normalizedActive);
    const toMarkDeleted = aliveRows
      .map((row) => row.imageIdentifierNormalized)
      .filter((identifier) => !activeSet.has(identifier));

    if (toMarkDeleted.length === 0) {
      return;
    }

    const now = new Date();
    await this.globalDatabaseService.db
      .update(dockerImageSecurityLifecycle)
      .set({
        lifecycleState: "deleted",
        deletedAt: now,
        updatedAt: now,
      })
      .where(inArray(dockerImageSecurityLifecycle.imageIdentifierNormalized, toMarkDeleted));

    for (const deletedIdentifier of toMarkDeleted) {
      await this.emitImageLifecycleRuntimeEvent("delete", "image_deleted", {
        imageIdentifierNormalized: deletedIdentifier,
      });
    }
  }

  async persistRuntimeActivityEvent(rawEvent: DockerRuntimeEvent): Promise<void> {
    const event = dockerRuntimeEventSchema.parse(rawEvent);
    const normalizedActorId = typeof event.actorId === "string" && event.actorId.trim().length > 0
      ? event.actorId.trim()
      : null;
    const now = new Date();
    const occurredAt = this.toTimestampDate(event.timestamp) ?? now;
    const isImageScanEvent = event.source === "image" && event.action.startsWith("scan_");

    const flowId = isImageScanEvent
      ? `image-scan-run:${normalizedActorId ?? "unknown"}`
      : `${event.source}:${normalizedActorId ?? event.eventId ?? "event"}`;

    const dependsOnFlowId = isImageScanEvent && event.action !== "scan_queued"
      ? `image-scan-queue:${normalizedActorId ?? "unknown"}`
      : null;

    const status = this.inferRuntimeActivityStatus(event.action, event.actorAttributes.scanState);
    const severity = this.inferRuntimeActivitySeverity(event.action);
    const progress = this.toProgress(event.actorAttributes.scanProgress);
    const scanner = this.toNullableNonEmptyString(event.actorAttributes.scanScanner);
    const stage = this.toNullableNonEmptyString(event.actorAttributes.scanStage) ?? this.toNullableNonEmptyString(event.actorAttributes.scanState);
    const message = this.toNullableNonEmptyString(event.actorAttributes.scanMessage)
      ?? this.toNullableNonEmptyString(event.actorAttributes.scanError)
      ?? this.resolveRuntimeActivityMessage(event);

    const eventFingerprint = this.createRuntimeActivityFingerprint(event);

    await this.globalDatabaseService.db
      .insert(dockerRuntimeActivities)
      .values({
        eventFingerprint,
        eventId: event.eventId,
        flowId,
        dependsOnFlowId,
        source: event.source,
        action: event.action,
        actorId: normalizedActorId,
        status,
        category: isImageScanEvent ? "image-scanning" : "runtime-event",
        severity,
        progress,
        stage,
        scanner,
        message,
        actorAttributes: event.actorAttributes,
        payload: event.payload as Record<string, unknown>,
        raw: event.raw,
        occurredAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [dockerRuntimeActivities.eventFingerprint],
      });
  }

  async listRuntimeActivities(input: DockerRuntimeActivityListInput) {
    const limit = input.limit;
    const offset = input.offset;

    const rows = await this.globalDatabaseService.db
      .select()
      .from(dockerRuntimeActivities)
      .orderBy(desc(dockerRuntimeActivities.occurredAt))
      .limit(5000);

    const mapped = rows.map((row) => dockerRuntimeActivityEntitySchema.parse({
      id: row.id,
      eventId: row.eventId,
      eventFingerprint: row.eventFingerprint,
      flowId: row.flowId,
      dependsOnFlowId: row.dependsOnFlowId,
      source: this.parseRuntimeActivitySource(row.source),
      action: row.action,
      actorId: row.actorId,
      status: row.status,
      category: row.category,
      severity: row.severity,
      progress: row.progress,
      stage: row.stage,
      scanner: row.scanner,
      message: row.message,
      actorAttributes: row.actorAttributes,
      payload: row.payload,
      raw: row.raw,
      occurredAt: row.occurredAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } satisfies DockerRuntimeActivityEntity));

    const filtered = mapped.filter((item) => {
      const sourceFilter = this.getFilterEntry(input, "source");
      const actionFilter = this.getFilterEntry(input, "action");
      const actorIdFilter = this.getFilterEntry(input, "actorId");
      const statusFilter = this.getFilterEntry(input, "status");
      const categoryFilter = this.getFilterEntry(input, "category");
      const severityFilter = this.getFilterEntry(input, "severity");
      const stageFilter = this.getFilterEntry(input, "stage");
      const scannerFilter = this.getFilterEntry(input, "scanner");
      const flowIdFilter = this.getFilterEntry(input, "flowId");
      const dependsOnFlowIdFilter = this.getFilterEntry(input, "dependsOnFlowId");

      return this.matchString(item.source, sourceFilter)
        && this.matchString(item.action, actionFilter)
        && this.matchString(item.actorId ?? "", actorIdFilter)
        && this.matchString(item.status, statusFilter)
        && this.matchString(item.category, categoryFilter)
        && this.matchString(item.severity, severityFilter)
        && this.matchString(item.stage ?? "", stageFilter)
        && this.matchString(item.scanner ?? "", scannerFilter)
        && this.matchString(item.flowId, flowIdFilter)
        && this.matchString(item.dependsOnFlowId ?? "", dependsOnFlowIdFilter);
    });

    const sorted = this.sortItems(filtered, input, (item, sortBy) => {
      switch (sortBy) {
        case "source":
          return item.source;
        case "action":
          return item.action;
        case "status":
          return item.status;
        case "category":
          return item.category;
        case "createdAt":
          return item.createdAt;
        case "updatedAt":
          return item.updatedAt;
        case "occurredAt":
        default:
          return item.occurredAt;
      }
    });

    return this.paginate(sorted, { limit, offset });
  }

  async getRuntimeActivityById(input: DockerRuntimeActivityDetailQueryInput): Promise<DockerRuntimeActivityEntity | null> {
    const row = await this.globalDatabaseService.db
      .select()
      .from(dockerRuntimeActivities)
      .where(eq(dockerRuntimeActivities.id, input.id))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!row) {
      return null;
    }

    return dockerRuntimeActivityEntitySchema.parse({
      id: row.id,
      eventId: row.eventId,
      eventFingerprint: row.eventFingerprint,
      flowId: row.flowId,
      dependsOnFlowId: row.dependsOnFlowId,
      source: this.parseRuntimeActivitySource(row.source),
      action: row.action,
      actorId: row.actorId,
      status: row.status,
      category: row.category,
      severity: row.severity,
      progress: row.progress,
      stage: row.stage,
      scanner: row.scanner,
      message: row.message,
      actorAttributes: row.actorAttributes,
      payload: row.payload,
      raw: row.raw,
      occurredAt: row.occurredAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } satisfies DockerRuntimeActivityEntity);
  }

  private buildImageInspectCandidates(imageId: string): string[] {
    const normalized = imageId.trim();
    if (normalized.length === 0) {
      return [];
    }

    const candidates = new Set<string>([normalized]);
    const shaPrefix = "sha256:";

    if (normalized.startsWith(shaPrefix)) {
      const withoutPrefix = normalized.slice(shaPrefix.length);
      if (withoutPrefix.length > 0) {
        candidates.add(withoutPrefix);
      }
    } else {
      candidates.add(`${shaPrefix}${normalized}`);
    }

    return [...candidates];
  }

  private normalizeImageIdentifier(value: string | null | undefined): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim().toLowerCase().replace(/^sha256:/u, "");
  }

  private normalizeDigestHash(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim().toLowerCase();
    if (trimmed.length === 0) {
      return null;
    }

    const digestPart = trimmed.includes(":")
      ? trimmed.slice(trimmed.indexOf(":") + 1)
      : trimmed;
    return digestPart.length > 0 ? digestPart : null;
  }

  private buildCanonicalImageIdentifier(input: {
    registry: string;
    repository: string;
    digest: string | null;
    fallbackId: string;
  }): string {
    const digestHash = this.normalizeDigestHash(input.digest);
    if (!digestHash) {
      return this.normalizeImageIdentifier(input.fallbackId);
    }

    const registry = this.normalizeImageRegistrySegment(input.registry).toLowerCase();
    const repository = this.normalizeImageRepositoryPath(input.repository).toLowerCase();
    return `${registry}/${repository}@${digestHash}`;
  }

  private async resolveLifecycleIdentifier(imageId: string): Promise<{
    imageIdentifierNormalized: string;
  }> {
    const inspect = await this.inspectImageWithCandidates(imageId);
    const inspectId = typeof inspect.Id === "string" && inspect.Id.length > 0 ? inspect.Id : imageId;
    const repoTags = this.toStringArray(inspect.RepoTags as string | string[] | undefined)
      .filter((tag) => tag !== "<none>:<none>");
    const repoDigests = this.toStringArray(inspect.RepoDigests as string | string[] | undefined)
      .filter((digest) => digest !== "<none>@<none>");

    const primaryRef = this.resolvePrimaryImageTag(repoTags, repoDigests) ?? imageId;
    const parsed = this.parseRegistryAndRepository(primaryRef);
    const normalizedDigest = this.normalizeImageDigest(repoDigests[0] ?? null);

    return {
      imageIdentifierNormalized: this.buildCanonicalImageIdentifier({
        registry: parsed.registry,
        repository: parsed.repository,
        digest: normalizedDigest,
        fallbackId: inspectId,
      }),
    };
  }

  private async ensureImageLifecycleAlive(imageId: string): Promise<DockerImageLifecycleUpsertResult> {
    const lifecycleKey = await this.resolveLifecycleIdentifier(imageId);
    const normalizedIdentifier = lifecycleKey.imageIdentifierNormalized;
    if (normalizedIdentifier.length === 0) {
      return {
        imageIdentifierNormalized: "",
        imageGeneration: 1,
        revived: false,
      };
    }

    const now = new Date();

    const existing = await this.globalDatabaseService.db
      .select({
        imageIdentifierNormalized: dockerImageSecurityLifecycle.imageIdentifierNormalized,
        currentGeneration: dockerImageSecurityLifecycle.currentGeneration,
        lifecycleState: dockerImageSecurityLifecycle.lifecycleState,
      })
      .from(dockerImageSecurityLifecycle)
      .where(eq(dockerImageSecurityLifecycle.imageIdentifierNormalized, normalizedIdentifier))
      .limit(1)
      .then((rows) => (rows[0] ?? null));

    if (!existing) {
      await this.globalDatabaseService.db
        .insert(dockerImageSecurityLifecycle)
        .values({
          imageIdentifierNormalized: normalizedIdentifier,
          currentGeneration: 1,
          lifecycleState: "alive",
          firstSeenAt: now,
          lastSeenAt: now,
          deletedAt: null,
          revivedAt: null,
          createdAt: now,
          updatedAt: now,
        });
      await this.emitImageLifecycleRuntimeEvent("create", "image_created", {
        imageIdentifierNormalized: normalizedIdentifier,
      });

      return {
        imageIdentifierNormalized: normalizedIdentifier,
        imageGeneration: 1,
        revived: false,
      };
    }

    if (existing.lifecycleState === "deleted") {
      const nextGeneration = existing.currentGeneration + 1;
      await this.globalDatabaseService.db
        .update(dockerImageSecurityLifecycle)
        .set({
          currentGeneration: nextGeneration,
          lifecycleState: "alive",
          lastSeenAt: now,
          deletedAt: null,
          revivedAt: now,
          updatedAt: now,
        })
        .where(eq(dockerImageSecurityLifecycle.imageIdentifierNormalized, normalizedIdentifier));
      await this.emitImageLifecycleRuntimeEvent("create", "image_revived", {
        imageIdentifierNormalized: normalizedIdentifier,
      });

      return {
        imageIdentifierNormalized: normalizedIdentifier,
        imageGeneration: nextGeneration,
        revived: true,
      };
    }

    await this.globalDatabaseService.db
      .update(dockerImageSecurityLifecycle)
      .set({
        lifecycleState: "alive",
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(dockerImageSecurityLifecycle.imageIdentifierNormalized, normalizedIdentifier));

    return {
      imageIdentifierNormalized: normalizedIdentifier,
      imageGeneration: existing.currentGeneration,
      revived: false,
    };
  }

  private async isImageGenerationScanStale(
    imageIdentifierNormalized: string,
    imageGeneration: number,
    maxAgeMs?: number,
  ): Promise<boolean> {
    if (typeof maxAgeMs !== "number" || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      return false;
    }

    let latest: { lastUpdated: Date } | null = null;
    try {
      latest = await this.globalDatabaseService.db
        .select({ lastUpdated: dockerImageSecurityScans.lastUpdated })
        .from(dockerImageSecurityScans)
        .where(and(
          eq(dockerImageSecurityScans.imageIdentifierNormalized, imageIdentifierNormalized),
          eq(dockerImageSecurityScans.imageGeneration, imageGeneration),
        ))
        .limit(1)
        .then((rows) => rows[0] ?? null);
    } catch (error: unknown) {
      if (!this.isMissingDockerSecurityScanTableError(error)) {
        throw error;
      }

      this.warnMissingDockerSecurityScanTableOnce();
      return false;
    }

    if (!latest) {
      return true;
    }

    const ageMs = Date.now() - latest.lastUpdated.getTime();
    return ageMs > maxAgeMs;
  }

  private async emitImageLifecycleRuntimeEvent(
    action: "create" | "delete",
    lifecycleEventType: "image_created" | "image_deleted" | "image_revived",
    payload: { imageIdentifierNormalized: string },
  ): Promise<void> {
    await this.persistRuntimeActivityEvent({
      type: "docker_event",
      source: "image",
      action,
      actorId: payload.imageIdentifierNormalized,
      actorAttributes: {
        lifecycleEventType,
        lifecycleState: lifecycleEventType.replace("image_", ""),
      },
      scope: "local",
      from: "docker-image-lifecycle",
      eventId: `lifecycle:${lifecycleEventType}:${payload.imageIdentifierNormalized}:${Date.now()}`,
      nodeId: null,
      timestamp: new Date().toISOString(),
      timestampNano: null,
      raw: { synthetic: true, lifecycle: "image_identifier" },
      payload: {
        imageId: payload.imageIdentifierNormalized,
        imageName: null,
        repository: null,
        tag: null,
      },
    });
  }

  private toNullableNonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toTimestampDate(value: string): Date | null {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private toProgress(value: string | undefined): number | null {
    if (typeof value !== "string") {
      return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    if (parsed <= 0) return 0;
    if (parsed >= 100) return 100;
    return Math.round(parsed);
  }

  private inferRuntimeActivityStatus(
    action: string,
    scanState?: string,
  ): "queued" | "running" | "completed" | "error" | "info" {
    const normalizedAction = action.toLowerCase();
    const normalizedState = scanState?.toLowerCase();

    if (normalizedState === "queued" || normalizedAction.includes("queued")) {
      return "queued";
    }

    if (normalizedState === "error" || normalizedAction.includes("error") || normalizedAction.includes("fail")) {
      return "error";
    }

    if (normalizedState === "completed" || normalizedAction.includes("complete") || normalizedAction.includes("done")) {
      return "completed";
    }

    if (
      normalizedAction.includes("start")
      || normalizedAction.includes("progress")
      || normalizedAction.includes("pull")
      || normalizedAction.includes("create")
      || normalizedAction.includes("update")
    ) {
      return "running";
    }

    return "info";
  }

  private inferRuntimeActivitySeverity(action: string): "info" | "warning" | "error" {
    const normalizedAction = action.toLowerCase();
    if (normalizedAction.includes("error") || normalizedAction.includes("fail")) {
      return "error";
    }

    if (
      normalizedAction.includes("die")
      || normalizedAction.includes("kill")
      || normalizedAction.includes("destroy")
      || normalizedAction.includes("delete")
      || normalizedAction.includes("remove")
    ) {
      return "warning";
    }

    return "info";
  }

  private resolveRuntimeActivityMessage(event: DockerRuntimeEvent): string | null {
    const payload = event.payload as Record<string, unknown>;
    const candidates = [
      payload.containerName,
      payload.imageName,
      payload.repository,
      payload.networkName,
      payload.volumeName,
      payload.serviceName,
    ];

    for (const candidate of candidates) {
      const normalized = this.toNullableNonEmptyString(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private createRuntimeActivityFingerprint(event: DockerRuntimeEvent): string {
    const payload = event.payload as Record<string, unknown>;
    return createHash("sha1")
      .update(
        [
          event.eventId ?? "",
          event.timestamp,
          event.source,
          event.action,
          event.actorId ?? "",
          JSON.stringify(payload),
        ].join("|"),
      )
      .digest("hex");
  }

  private parseRuntimeActivitySource(value: string): DockerRuntimeEvent["source"] {
    const parsed = dockerRuntimeEventSourceSchema.safeParse(value);
    return parsed.success ? parsed.data : "unknown";
  }

  private identifiersMatch(left: string | null | undefined, right: string | null | undefined): boolean {
    const normalizedLeft = this.normalizeImageIdentifier(left);
    const normalizedRight = this.normalizeImageIdentifier(right);

    if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
      return false;
    }

    return (
      normalizedLeft === normalizedRight
      || normalizedLeft.startsWith(normalizedRight)
      || normalizedRight.startsWith(normalizedLeft)
    );
  }

  private buildImageInspectCandidatesFromImageList(
    imageId: string,
    images: Record<string, unknown>[],
  ): string[] {
    const requested = imageId.trim();
    const candidates = new Set<string>();

    for (const image of images) {
      const rawImageId = typeof image.Id === "string" ? image.Id.trim() : "";
      const repoTags = this
        .toStringArray(image.RepoTags as string | string[] | undefined)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0 && tag !== "<none>:<none>");

      const repoDigests = this
        .toStringArray(image.RepoDigests as string | string[] | undefined)
        .map((digest) => digest.trim())
        .filter((digest) => digest.length > 0 && digest !== "<none>@<none>");

      const digestHashes = repoDigests
        .map((digest) => {
          const digestSeparatorIndex = digest.indexOf("@");
          return digestSeparatorIndex === -1 ? digest : digest.slice(digestSeparatorIndex + 1);
        })
        .filter((digest) => digest.length > 0);

      const hasMatch = [
        rawImageId,
        ...repoTags,
        ...repoDigests,
        ...digestHashes,
      ].some((candidate) => this.identifiersMatch(candidate, requested));

      if (!hasMatch) {
        continue;
      }

      if (rawImageId.length > 0) {
        candidates.add(rawImageId);
      }

      for (const repoTag of repoTags) {
        candidates.add(repoTag);
      }

      for (const repoDigest of repoDigests) {
        candidates.add(repoDigest);
      }
    }

    return [...candidates];
  }

  private async inspectImageWithCandidates(imageId: string): Promise<Record<string, unknown>> {
    const docker = this.dockerService.getDockerClient();
    const candidates = this.buildImageInspectCandidates(imageId);

    for (const candidate of candidates) {
      try {
        return (await docker.getImage(candidate).inspect()) as unknown as Record<string, unknown>;
      } catch {
        // Try next candidate.
      }
    }

    const images = (await docker.listImages()) as unknown as Record<string, unknown>[];
    const resolvedCandidates = this.buildImageInspectCandidatesFromImageList(imageId, images);

    for (const candidate of resolvedCandidates) {
      try {
        return (await docker.getImage(candidate).inspect()) as unknown as Record<string, unknown>;
      } catch {
        // Try next candidate.
      }
    }

    throw new NotFoundException(`Image '${imageId}' not found`);
  }

  private async readPersistedImageSecurityScan(
    imageCandidates: string[],
  ): Promise<{ vulnerabilities: DockerImageInspectDetail["vulnerabilities"]; scanSummary: RawImageSecurityScan["scanSummary"] } | null> {
    const normalizedCandidates = [...new Set(
      imageCandidates
        .map((candidate) => this.normalizeImageIdentifier(candidate))
        .filter((candidate) => candidate.length > 0),
    )];

    if (normalizedCandidates.length === 0) {
      return null;
    }

    let persisted: {
      vulnerabilities: unknown;
      scanSummary: Record<string, unknown>;
      imageGeneration: number;
      lastUpdated: Date;
    } | null;

    try {
      persisted = await this.globalDatabaseService.db
        .select({
          vulnerabilities: dockerImageSecurityScans.vulnerabilities,
          scanSummary: dockerImageSecurityScans.scanSummary,
          imageGeneration: dockerImageSecurityScans.imageGeneration,
          lastUpdated: dockerImageSecurityScans.lastUpdated,
        })
        .from(dockerImageSecurityScans)
        .where(inArray(dockerImageSecurityScans.imageIdentifierNormalized, normalizedCandidates))
        .orderBy(desc(dockerImageSecurityScans.imageGeneration), desc(dockerImageSecurityScans.lastUpdated))
        .limit(1)
        .then((rows) => rows[0] ?? null);
    } catch (error: unknown) {
      if (!this.isMissingDockerSecurityScanTableError(error)) {
        throw error;
      }

      this.warnMissingDockerSecurityScanTableOnce();
      return null;
    }

    if (!persisted) {
      return null;
    }

    const vulnerabilities = persisted.vulnerabilities as DockerImageInspectDetail["vulnerabilities"];
    const rawSummary = persisted.scanSummary;

    const scannedAt = persisted.lastUpdated.toISOString();
    const scannerList = Array.isArray(rawSummary.scanners)
      ? (rawSummary.scanners as DockerImageScannerResult[])
      : [];

    const scanSummary: RawImageSecurityScan["scanSummary"] = {
      scannedAt,
      totalFindings:
        typeof rawSummary.totalFindings === "number"
          ? rawSummary.totalFindings
          : vulnerabilities.length,
      scanners: scannerList,
      layerEfficiency:
        (rawSummary.layerEfficiency as DockerImageLayerEfficiency | null | undefined)
        ?? null,
    };

    return {
      vulnerabilities,
      scanSummary,
    };
  }

  private async persistImageSecurityScan(inspectId: string, scanResult: RawImageSecurityScan): Promise<void> {
    const lifecycle = await this.ensureImageLifecycleAlive(inspectId);
    if (lifecycle.imageIdentifierNormalized.length === 0) {
      return;
    }

    const now = new Date();
    const serializedSummary = JSON.stringify(scanResult.scanSummary);
    const serializedVulnerabilities = JSON.stringify(scanResult.vulnerabilities);
    const scanHash = createHash("sha1")
      .update(`${lifecycle.imageIdentifierNormalized}:${String(lifecycle.imageGeneration)}:${serializedSummary}:${serializedVulnerabilities}`)
      .digest("hex");

    try {
      await this.globalDatabaseService.db
        .insert(dockerImageSecurityScanHistory)
        .values({
          imageId: inspectId,
          imageIdentifierNormalized: lifecycle.imageIdentifierNormalized,
          imageGeneration: lifecycle.imageGeneration,
          scanHash,
          vulnerabilities: scanResult.vulnerabilities,
          scanSummary: scanResult.scanSummary,
          scanStatus: "completed",
          createdAt: now,
        })
        .onConflictDoNothing({
          target: [dockerImageSecurityScanHistory.scanHash],
        });

      await this.globalDatabaseService.db
        .insert(dockerImageSecurityScans)
        .values({
          imageId: inspectId,
          imageIdentifierNormalized: lifecycle.imageIdentifierNormalized,
          imageGeneration: lifecycle.imageGeneration,
          vulnerabilities: scanResult.vulnerabilities,
          scanSummary: scanResult.scanSummary,
          scanStatus: "completed",
          lastUpdated: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [dockerImageSecurityScans.imageIdentifierNormalized, dockerImageSecurityScans.imageGeneration],
          set: {
            imageId: inspectId,
            imageGeneration: lifecycle.imageGeneration,
            vulnerabilities: scanResult.vulnerabilities,
            scanSummary: scanResult.scanSummary,
            scanStatus: "completed",
            lastUpdated: now,
            updatedAt: now,
          },
        });
    } catch (error: unknown) {
      if (!this.isMissingDockerSecurityScanTableError(error)) {
        throw error;
      }

      this.warnMissingDockerSecurityScanTableOnce();
    }
  }

  private isMissingDockerSecurityScanTableError(error: unknown): boolean {
    const queue: unknown[] = [error];
    const visited = new Set<unknown>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (current == null || visited.has(current)) {
        continue;
      }
      visited.add(current);

      const code = (
        typeof current === "object"
        && "code" in current
        && typeof (current as { code?: unknown }).code === "string"
      )
        ? (current as { code: string }).code
        : null;

      if (code === "42P01") {
        return true;
      }

      const message = this.formatError(current).toLowerCase();
      if (
        message.includes('relation "docker_image_security_scans" does not exist')
        || (message.includes("docker_image_security_scans") && message.includes("does not exist"))
        || (message.includes("docker_image_security_scans") && message.includes("42p01"))
      ) {
        return true;
      }

      if (typeof current === "object") {
        const candidate = current as {
          cause?: unknown;
          originalError?: unknown;
          error?: unknown;
        };

        if (candidate.cause !== undefined) {
          queue.push(candidate.cause);
        }
        if (candidate.originalError !== undefined) {
          queue.push(candidate.originalError);
        }
        if (candidate.error !== undefined) {
          queue.push(candidate.error);
        }
      }
    }

    return false;
  }

  private warnMissingDockerSecurityScanTableOnce(): void {
    if (this.hasWarnedMissingSecurityScanTable) {
      return;
    }

    this.hasWarnedMissingSecurityScanTable = true;
    this.logger.warn(
      "Table docker_image_security_scans is missing. Docker image security scan cache will be skipped until database migrations are applied.",
    );
  }

  private async resolveImageVulnerabilities(
    inspectId: string,
    scanTargets: string[],
    options: { allowFreshScan?: boolean } = {},
  ): Promise<ResolvedImageSecurityScan> {
    const allowFreshScan = options.allowFreshScan ?? true;

    const persisted = await this.readPersistedImageSecurityScan([inspectId, ...scanTargets]);
    if (persisted) {
      return {
        vulnerabilities: persisted.vulnerabilities,
        scanSummary: {
          ...persisted.scanSummary,
          cached: true,
        },
      };
    }

    if (!allowFreshScan) {
      return {
        vulnerabilities: [],
        scanSummary: null,
      };
    }

    const inFlight = this.imageVulnerabilityScansInFlight.get(inspectId);
    if (inFlight) {
      const inFlightScan = await inFlight;
      return {
        vulnerabilities: inFlightScan.vulnerabilities,
        scanSummary: {
          ...inFlightScan.scanSummary,
          cached: false,
        },
      };
    }

    const scanPromise = this.scanImageVulnerabilities(scanTargets)
      .then(async (scanResult) => {
        await this.persistImageSecurityScan(inspectId, scanResult);
        return scanResult;
      })
      .catch((error: unknown) => {
        this.logger.warn(`Image vulnerability scan failed for ${inspectId}: ${this.formatError(error)}`);

        const executedAt = new Date().toISOString();
        return {
          vulnerabilities: [],
          scanSummary: {
            scannedAt: executedAt,
            totalFindings: 0,
            scanners: [
              {
                scanner: "trivy",
                status: "failed",
                findingsCount: 0,
                durationMs: null,
                executedAt,
                error: this.formatError(error),
              },
              {
                scanner: "grype",
                status: "failed",
                findingsCount: 0,
                durationMs: null,
                executedAt,
                error: this.formatError(error),
              },
              {
                scanner: "dive",
                status: "failed",
                findingsCount: 0,
                durationMs: null,
                executedAt,
                error: this.formatError(error),
              },
            ],
            layerEfficiency: null,
          },
        } satisfies RawImageSecurityScan;
      })
      .finally(() => {
        this.imageVulnerabilityScansInFlight.delete(inspectId);
      });

    this.imageVulnerabilityScansInFlight.set(inspectId, scanPromise);
    const freshScan = await scanPromise;
    return {
      vulnerabilities: freshScan.vulnerabilities,
      scanSummary: {
        ...freshScan.scanSummary,
        cached: false,
      },
    };
  }

  private async scanImageVulnerabilities(
    scanTargets: string[],
  ): Promise<RawImageSecurityScan> {
    if (scanTargets.length === 0) {
      const executedAt = new Date().toISOString();
      return {
        vulnerabilities: [],
        scanSummary: {
          scannedAt: executedAt,
          totalFindings: 0,
          scanners: [
            {
              scanner: "trivy",
              status: "skipped",
              findingsCount: 0,
              durationMs: 0,
              executedAt,
              error: "No scan targets available",
            },
            {
              scanner: "grype",
              status: "skipped",
              findingsCount: 0,
              durationMs: 0,
              executedAt,
              error: "No scan targets available",
            },
            {
              scanner: "dive",
              status: "skipped",
              findingsCount: 0,
              durationMs: 0,
              executedAt,
              error: "No scan targets available",
            },
          ],
          layerEfficiency: null,
        },
      };
    }

    // Ensure all three shared scanner containers are running before launching tasks
    await Promise.all([
      this.scannerContainerManager.ensureContainerRunning("trivy"),
      this.scannerContainerManager.ensureContainerRunning("grype"),
      this.scannerContainerManager.ensureContainerRunning("dive"),
    ]);

    const [trivyResult, grypeResult, diveResult] = await this.runScannerTasksWithConcurrency(
      [
        () => this.scanUsingTrivy(scanTargets),
        () => this.scanUsingGrype(scanTargets),
        () => this.scanUsingDive(scanTargets),
      ] as const,
      this.resolveScannerParallelism(),
    );

    const mergedVulnerabilities = this.mergeVulnerabilityEntries([
      ...trivyResult.vulnerabilities,
      ...grypeResult.vulnerabilities,
    ]);

    const scannedAt = new Date().toISOString();

    return {
      vulnerabilities: mergedVulnerabilities,
      scanSummary: {
        scannedAt,
        totalFindings: mergedVulnerabilities.length,
        scanners: [trivyResult.scannerResult, grypeResult.scannerResult, diveResult.scannerResult],
        layerEfficiency: diveResult.layerEfficiency,
      },
    };
  }

  private async scanImageVulnerabilitiesWithProgress(
    imageId: string,
    scanTargets: string[],
    options: ScannerRunProgressOptions,
  ): Promise<RawImageSecurityScan> {
    if (scanTargets.length === 0) {
      const executedAt = new Date().toISOString();
      const skippedScanners: DockerImageScannerResult[] = ["trivy", "grype", "dive"].map((scanner) => ({
        scanner,
        status: "skipped",
        findingsCount: 0,
        durationMs: 0,
        executedAt,
        error: "No scan targets available",
      })) as DockerImageScannerResult[];

      const scanSummary: RawImageSecurityScan["scanSummary"] = {
        scannedAt: executedAt,
        totalFindings: 0,
        scanners: skippedScanners,
        layerEfficiency: null,
      };

      options.onEvent?.(this.buildScanEvent({
        imageId,
        type: "complete",
        stage: "completed",
        scanner: null,
        progress: 100,
        message: "No scan targets available",
        logLine: null,
        scanSummary: {
          ...scanSummary,
          cached: false,
        },
      }));

      return {
        vulnerabilities: [],
        scanSummary,
      };
    }

    options.onEvent?.(this.buildScanEvent({
      imageId,
      type: "status",
      stage: "scanning",
      scanner: null,
      progress: 10,
      message: "Starting multi-scanner security scan",
      logLine: null,
    }));

    // Ensure all three shared scanner containers are running before launching tasks
    await Promise.all([
      this.scannerContainerManager.ensureContainerRunning("trivy"),
      this.scannerContainerManager.ensureContainerRunning("grype"),
      this.scannerContainerManager.ensureContainerRunning("dive"),
    ]);

    const progressOptions: ScannerRunProgressOptions = {
      ...options,
      imageId,
    };

    const [trivyResult, grypeResult, diveResult] = await this.runScannerTasksWithConcurrency(
      [
        () => this.scanUsingTrivy(scanTargets, progressOptions),
        () => this.scanUsingGrype(scanTargets, progressOptions),
        () => this.scanUsingDive(scanTargets, progressOptions),
      ] as const,
      this.resolveScannerParallelism(),
    );

    options.onEvent?.(this.buildScanEvent({
      imageId,
      type: "status",
      stage: "merging",
      scanner: null,
      progress: 90,
      message: "Merging scanner findings",
      logLine: null,
    }));

    const mergedVulnerabilities = this.mergeVulnerabilityEntries([
      ...trivyResult.vulnerabilities,
      ...grypeResult.vulnerabilities,
    ]);

    const scannedAt = new Date().toISOString();
    const scanSummary: RawImageSecurityScan["scanSummary"] = {
      scannedAt,
      totalFindings: mergedVulnerabilities.length,
      scanners: [trivyResult.scannerResult, grypeResult.scannerResult, diveResult.scannerResult],
      layerEfficiency: diveResult.layerEfficiency,
    };

    options.onEvent?.(this.buildScanEvent({
      imageId,
      type: "complete",
      stage: "completed",
      scanner: null,
      progress: 100,
      message: "Security scan completed",
      logLine: null,
      scanSummary: {
        ...scanSummary,
        cached: false,
      },
      vulnerabilities: mergedVulnerabilities,
    }));

    return {
      vulnerabilities: mergedVulnerabilities,
      scanSummary,
    };
  }

  private async scanUsingTrivy(
    scanTargets: string[],
    options?: ScannerRunProgressOptions,
  ): Promise<ScannerRunResult> {
    const startedAt = Date.now();
    let lastError: string | null = null;
    const imageId = options?.imageId ?? scanTargets[0] ?? "unknown-image";

    for (const target of scanTargets) {
      const command: string[] = [
        "trivy",
        "image",
        "--quiet",
        "--format",
        "json",
        "--severity",
        "CRITICAL,HIGH,MEDIUM,LOW",
        "--timeout",
        "2m",
        target,
      ];

      const fallbackConfig: ScannerExecutionConfig = {
        scanner: "trivy",
        image: "aquasec/trivy:0.69.3",
        command: [
          "image",
          "--quiet",
          "--format",
          "json",
          "--severity",
          "CRITICAL,HIGH,MEDIUM,LOW",
          "--timeout",
          "2m",
          target,
        ],
      };

      options?.onEvent?.(this.buildScanEvent({
        imageId,
        type: "status",
        stage: "pulling-scanner",
        scanner: "trivy",
        progress: 20,
        message: `Preparing Trivy scanner for target ${target}`,
        logLine: null,
      }));

      try {
        const result = await this.executeScannerViaSharedContainer("trivy", command, fallbackConfig, {
          logPollIntervalMs: options?.logPollIntervalMs,
          onPullLogLine: (line) => {
            options?.onEvent?.(this.buildScanEvent({
              imageId,
              type: "log",
              stage: "pulling-scanner",
              scanner: "trivy",
              progress: 20,
              message: "Trivy scanner image pull output",
              logLine: line,
            }));
          },
          onLogLine: (line) => {
            options?.onEvent?.(this.buildScanEvent({
              imageId,
              type: "log",
              stage: "scanning",
              scanner: "trivy",
              progress: 35,
              message: "Trivy output",
              logLine: line,
            }));
          },
        });
        if (result.exitCode !== 0) {
          lastError = `exit_code_${String(result.exitCode)}`;
          this.logger.debug(`Trivy scan returned exit code ${String(result.exitCode)} for ${target}`);
          continue;
        }

        const vulnerabilities = this.parseTrivyVulnerabilities(result.output);
        const completed: ScannerRunResult = {
          vulnerabilities,
          layerEfficiency: null,
          scannerResult: {
            scanner: "trivy",
            status: "completed",
            findingsCount: vulnerabilities.length,
            durationMs: result.durationMs,
            executedAt: result.executedAt,
            error: null,
          },
        };

        options?.onEvent?.(this.buildScanEvent({
          imageId,
          type: "result",
          stage: "parsing",
          scanner: "trivy",
          progress: 45,
          message: `Trivy completed with ${String(vulnerabilities.length)} findings`,
          logLine: null,
          scannerResult: completed.scannerResult,
        }));

        return completed;
      } catch (error) {
        lastError = this.formatError(error);
        this.logger.debug(`Trivy scan attempt failed for ${target}: ${this.formatError(error)}`);
      }
    }

    const failedResult: ScannerRunResult = {
      vulnerabilities: [],
      layerEfficiency: null,
      scannerResult: {
        scanner: "trivy",
        status: "failed",
        findingsCount: 0,
        durationMs: Date.now() - startedAt,
        executedAt: new Date().toISOString(),
        error: lastError ?? "No successful scan target",
      },
    };

    options?.onEvent?.(this.buildScanEvent({
      imageId,
      type: "error",
      stage: "error",
      scanner: "trivy",
      progress: null,
      message: "Trivy scan failed",
      logLine: failedResult.scannerResult.error,
      scannerResult: failedResult.scannerResult,
    }));

    return failedResult;
  }

  private async scanUsingGrype(
    scanTargets: string[],
    options?: ScannerRunProgressOptions,
  ): Promise<ScannerRunResult> {
    const startedAt = Date.now();
    let lastError: string | null = null;
    const imageId = options?.imageId ?? scanTargets[0] ?? "unknown-image";

    for (const target of scanTargets) {
      const command: string[] = [
        "grype",
        `docker:${target}`,
        "--output",
        "json",
        "--quiet",
      ];

      const fallbackConfig: ScannerExecutionConfig = {
        scanner: "grype",
        image: "anchore/grype:latest",
        command: [
          `docker:${target}`,
          "--output",
          "json",
          "--quiet",
        ],
      };

      options?.onEvent?.(this.buildScanEvent({
        imageId,
        type: "status",
        stage: "pulling-scanner",
        scanner: "grype",
        progress: 50,
        message: `Preparing Grype scanner for target ${target}`,
        logLine: null,
      }));

      try {
        const result = await this.executeScannerViaSharedContainer("grype", command, fallbackConfig, {
          logPollIntervalMs: options?.logPollIntervalMs,
          onPullLogLine: (line) => {
            options?.onEvent?.(this.buildScanEvent({
              imageId,
              type: "log",
              stage: "pulling-scanner",
              scanner: "grype",
              progress: 50,
              message: "Grype scanner image pull output",
              logLine: line,
            }));
          },
          onLogLine: (line) => {
            options?.onEvent?.(this.buildScanEvent({
              imageId,
              type: "log",
              stage: "scanning",
              scanner: "grype",
              progress: 60,
              message: "Grype output",
              logLine: line,
            }));
          },
        });
        if (result.exitCode !== 0) {
          lastError = `exit_code_${String(result.exitCode)}`;
          this.logger.debug(`Grype scan returned exit code ${String(result.exitCode)} for ${target}`);
          continue;
        }

        const vulnerabilities = this.parseGrypeVulnerabilities(result.output);
        const completed: ScannerRunResult = {
          vulnerabilities,
          layerEfficiency: null,
          scannerResult: {
            scanner: "grype",
            status: "completed",
            findingsCount: vulnerabilities.length,
            durationMs: result.durationMs,
            executedAt: result.executedAt,
            error: null,
          },
        };

        options?.onEvent?.(this.buildScanEvent({
          imageId,
          type: "result",
          stage: "parsing",
          scanner: "grype",
          progress: 70,
          message: `Grype completed with ${String(vulnerabilities.length)} findings`,
          logLine: null,
          scannerResult: completed.scannerResult,
        }));

        return completed;
      } catch (error) {
        lastError = this.formatError(error);
        this.logger.debug(`Grype scan attempt failed for ${target}: ${this.formatError(error)}`);
      }
    }

    const failedResult: ScannerRunResult = {
      vulnerabilities: [],
      layerEfficiency: null,
      scannerResult: {
        scanner: "grype",
        status: "failed",
        findingsCount: 0,
        durationMs: Date.now() - startedAt,
        executedAt: new Date().toISOString(),
        error: lastError ?? "No successful scan target",
      },
    };

    options?.onEvent?.(this.buildScanEvent({
      imageId,
      type: "error",
      stage: "error",
      scanner: "grype",
      progress: null,
      message: "Grype scan failed",
      logLine: failedResult.scannerResult.error,
      scannerResult: failedResult.scannerResult,
    }));

    return failedResult;
  }

  private async scanUsingDive(
    scanTargets: string[],
    options?: ScannerRunProgressOptions,
  ): Promise<ScannerRunResult> {
    const startedAt = Date.now();
    let lastError: string | null = null;
    const imageId = options?.imageId ?? scanTargets[0] ?? "unknown-image";

    for (const target of scanTargets) {
      const targetCandidates = [target, `docker://${target}`]
        .filter((candidate, index, all) => all.indexOf(candidate) === index);

      for (const candidate of targetCandidates) {
        const command: string[] = [
          "dive",
          "--ci",
          "--lowestEfficiency",
          "0",
          candidate,
        ];

        const fallbackConfig: ScannerExecutionConfig = {
          scanner: "dive",
          image: "wagoodman/dive:latest",
          command: [
            "--ci",
            "--lowestEfficiency",
            "0",
            candidate,
          ],
        };

        options?.onEvent?.(this.buildScanEvent({
          imageId,
          type: "status",
          stage: "pulling-scanner",
          scanner: "dive",
          progress: 75,
          message: `Preparing Dive scanner for target ${candidate}`,
          logLine: null,
        }));

        try {
          const result = await this.executeScannerViaSharedContainer("dive", command, fallbackConfig, {
            logPollIntervalMs: options?.logPollIntervalMs,
            onPullLogLine: (line) => {
              options?.onEvent?.(this.buildScanEvent({
                imageId,
                type: "log",
                stage: "pulling-scanner",
                scanner: "dive",
                progress: 75,
                message: "Dive scanner image pull output",
                logLine: line,
              }));
            },
            onLogLine: (line) => {
              options?.onEvent?.(this.buildScanEvent({
                imageId,
                type: "log",
                stage: "scanning",
                scanner: "dive",
                progress: 82,
                message: "Dive output",
                logLine: line,
              }));
            },
          });
          if (result.exitCode !== 0) {
            lastError = `exit_code_${String(result.exitCode)}`;
            this.logger.debug(`Dive scan returned exit code ${String(result.exitCode)} for ${candidate}`);
            continue;
          }

          const layerEfficiency = this.parseDiveLayerEfficiency(result.output);
          const completed: ScannerRunResult = {
            vulnerabilities: [],
            layerEfficiency,
            scannerResult: {
              scanner: "dive",
              status: layerEfficiency ? "completed" : "unavailable",
              findingsCount: 0,
              durationMs: result.durationMs,
              executedAt: result.executedAt,
              error: layerEfficiency ? null : "Dive output did not expose layer efficiency metrics",
            },
          };

          options?.onEvent?.(this.buildScanEvent({
            imageId,
            type: "result",
            stage: "parsing",
            scanner: "dive",
            progress: 88,
            message: layerEfficiency
              ? "Dive completed with layer efficiency insights"
              : "Dive completed without parseable layer efficiency",
            logLine: null,
            scannerResult: completed.scannerResult,
          }));

          return completed;
        } catch (error) {
          lastError = this.formatError(error);
          this.logger.debug(`Dive scan attempt failed for ${candidate}: ${this.formatError(error)}`);
        }
      }
    }

    const failedResult: ScannerRunResult = {
      vulnerabilities: [],
      layerEfficiency: null,
      scannerResult: {
        scanner: "dive",
        status: "failed",
        findingsCount: 0,
        durationMs: Date.now() - startedAt,
        executedAt: new Date().toISOString(),
        error: lastError ?? "No successful scan target",
      },
    };

    options?.onEvent?.(this.buildScanEvent({
      imageId,
      type: "error",
      stage: "error",
      scanner: "dive",
      progress: null,
      message: "Dive scan failed",
      logLine: failedResult.scannerResult.error,
      scannerResult: failedResult.scannerResult,
    }));

    return failedResult;
  }

  private resolveScannerParallelism(): number {
    const raw = process.env.APP_DOCKER_IMAGE_SCAN_PARALLELISM;
    if (typeof raw !== "string") {
      return DEFAULT_IMAGE_SCAN_SCANNER_PARALLELISM;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_IMAGE_SCAN_SCANNER_PARALLELISM;
    }

    return Math.min(3, Math.max(1, parsed));
  }

  private async runScannerTasksWithConcurrency<TTasks extends readonly (() => Promise<unknown>)[]>(
    tasks: TTasks,
    concurrency: number,
  ): Promise<{ [K in keyof TTasks]: Awaited<ReturnType<TTasks[K]>> }> {
    if (tasks.length === 0) {
      return [] as { [K in keyof TTasks]: Awaited<ReturnType<TTasks[K]>> };
    }

    const normalizedConcurrency = Math.max(1, Math.min(tasks.length, concurrency));
    const results = new Array<unknown>(tasks.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < tasks.length) {
        const currentIndex = cursor;
        cursor += 1;

        const task = tasks[currentIndex];
        if (!task) {
          continue;
        }

        results[currentIndex] = await task();
      }
    };

    await Promise.all(
      Array.from({ length: normalizedConcurrency }).map(() => worker()),
    );

    return results as { [K in keyof TTasks]: Awaited<ReturnType<TTasks[K]>> };
  }

  private async scannerImageExistsLocally(image: string): Promise<boolean> {
    try {
      await this.dockerService.getDockerClient().getImage(image).inspect();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a scanner command inside the shared scanner container.
   * Falls back to a per-scanner ephemeral container if the shared
   * container is unavailable (e.g. image not built yet, disabled).
   */
  private async executeScannerViaSharedContainer(
    scanner: string,
    command: string[],
    fallbackConfig: ScannerExecutionConfig,
    progressOptions: ScannerExecutionProgressOptions = {},
  ): Promise<ScannerExecutionResult> {
    const startedAt = Date.now();
    const scannerType = scanner as "trivy" | "grype" | "dive";

    // Try shared container first
    const ready = await this.scannerContainerManager.ensureContainerRunning(scannerType);
    if (ready) {
      try {
        const result = await this.scannerContainerManager.execInScanner(scannerType, command);
        return {
          scanner,
          exitCode: result.exitCode,
          output: result.output,
          durationMs: result.durationMs,
          executedAt: new Date().toISOString(),
        };
      } catch (error) {
        this.logger.debug(
          `Shared container exec failed for ${scanner}, falling back to ephemeral container: ${this.formatError(error)}`,
        );
      }
    }

    // Fallback: use the old per-scanner ephemeral container
    this.logger.debug(`Using ephemeral container fallback for ${scanner}`);
    return this.executeScannerContainer(fallbackConfig, progressOptions);
  }

  private async executeScannerContainer(
    config: ScannerExecutionConfig,
    progressOptions: ScannerExecutionProgressOptions = {},
  ): Promise<ScannerExecutionResult> {
    const startedAt = Date.now();
    const randomSuffix = createHash("sha1")
      .update(`${config.scanner}:${Date.now().toString()}:${Math.random().toString()}`)
      .digest("hex")
      .slice(0, 8);
    const containerName = `deployer-${config.scanner}-scan-${randomSuffix}`;

    const scannerImageExists = await this.scannerImageExistsLocally(config.image);
    if (!scannerImageExists) {
      try {
        await this.dockerService.pullImage(config.image, undefined, 3, 2_000, (line) => {
          const normalized = line.trim();
          if (normalized.length > 0) {
            progressOptions.onPullLogLine?.(normalized);
          }
        });
      } catch (error) {
        this.logger.debug(`Unable to pre-pull scanner image ${config.image}: ${this.formatError(error)}`);
      }
    }

    const socketBind = this.dockerService.getDockerSocketBindMount();
    const envVars: string[] = [];

    if (socketBind) {
      const hostPath = socketBind.split(":")[0];
      envVars.push(`DOCKER_HOST=unix://${hostPath}`);
    }

    const created = await this.dockerService.createContainer({
      Image: config.image,
      name: containerName,
      Cmd: config.command,
      Env: envVars.length > 0 ? envVars : undefined,
      HostConfig: {
        AutoRemove: false,
        Binds: socketBind ? [socketBind] : undefined,
      },
      Tty: false,
    });

    const scannerContainerId = created.id;

    try {
      await this.dockerService.startContainer(scannerContainerId);

      const normalizedLogPollIntervalMs = Math.max(
        200,
        progressOptions.logPollIntervalMs ?? VULNERABILITY_LOG_POLL_INTERVAL_MS,
      );
      const emittedLines = new Set<string>();
      let latestOutput = "";

      const emitNewLines = (output: string) => {
        latestOutput = output;
        if (!progressOptions.onLogLine) {
          return;
        }

        const lines = this.splitScannerOutputLines(output);
        for (const line of lines) {
          const normalized = line.trim();
          if (normalized.length === 0) {
            continue;
          }

          const key = `${config.scanner}|${normalized}`;
          if (emittedLines.has(key)) {
            continue;
          }

          emittedLines.add(key);
          progressOptions.onLogLine(normalized);
        }
      };

      const fetchLatestLogs = async () => {
        const output = await this.dockerService.getContainerLogs(scannerContainerId, {
          stdout: true,
          stderr: true,
          tail: VULNERABILITY_LOG_TAIL,
        });
        emitNewLines(output);
      };

      const logPoller = setInterval(() => {
        void fetchLatestLogs().catch(() => {
          // Ignore transient polling errors while the scanner is still running.
        });
      }, normalizedLogPollIntervalMs);

      void fetchLatestLogs().catch(() => {
        // Ignore first-pass fetch errors and rely on subsequent polling.
      });

      let waitResult = 1;
      try {
        waitResult = await this.waitForContainerExit(scannerContainerId, VULNERABILITY_SCAN_TIMEOUT_MS);
      } finally {
        clearInterval(logPoller);
      }

      await fetchLatestLogs().catch(() => {
        // Keep latest known output if the terminal fetch fails.
      });

      return {
        scanner: config.scanner,
        exitCode: waitResult,
        output: latestOutput,
        durationMs: Date.now() - startedAt,
        executedAt: new Date().toISOString(),
      };
    } finally {
      await this.cleanupScannerContainer(scannerContainerId, config.scanner);
    }
  }

  private async cleanupScannerContainer(
    containerId: string,
    scanner: ScannerExecutionConfig["scanner"],
  ): Promise<void> {
    const dockerClient = this.dockerService.getDockerClient();

    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.dockerService.removeContainer(containerId);

      const container = dockerClient.getContainer(containerId);

      try {
        await container.inspect();
      } catch (error) {
        if (this.isContainerNotFoundError(error)) {
          return;
        }

        this.logger.debug(
          `Scanner container ${containerId} inspect check failed after cleanup attempt ${String(attempt)}: ${this.formatError(error)}`,
        );

        if (attempt < 3) {
          await this.delay(200 * attempt);
        }

        continue;
      }

      try {
        await container.remove({ force: true, v: true });
      } catch (error) {
        if (this.isContainerNotFoundError(error)) {
          return;
        }

        this.logger.debug(
          `Scanner container ${containerId} force-remove attempt ${String(attempt)} failed: ${this.formatError(error)}`,
        );
      }

      try {
        await container.inspect();
      } catch (error) {
        if (this.isContainerNotFoundError(error)) {
          return;
        }
      }

      if (attempt < 3) {
        await this.delay(200 * attempt);
      }
    }

    this.logger.warn(
      `Scanner container ${containerId} for ${scanner} still exists after cleanup retries`,
    );
  }

  private isContainerNotFoundError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
      return false;
    }

    const record = error as Record<string, unknown>;

    if (record.statusCode === 404) {
      return true;
    }

    const reason = typeof record.reason === "string" ? record.reason.toLowerCase() : "";
    if (reason.includes("no such container")) {
      return true;
    }

    const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
    if (message.includes("no such container")) {
      return true;
    }

    const jsonMessage =
      typeof record.json === "object"
      && record.json !== null
      && typeof (record.json as Record<string, unknown>).message === "string"
        ? ((record.json as Record<string, unknown>).message as string).toLowerCase()
        : "";

    return jsonMessage.includes("no such container");
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async waitForContainerExit(containerId: string, timeoutMs: number): Promise<number> {
    const container = this.dockerService.getDockerClient().getContainer(containerId);
    let timeoutId: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Timed out waiting for scanner container ${containerId}`));
      }, timeoutMs);
    });

    const waitPromise = container
      .wait()
      .then((result) => {
        if (typeof result === "number") {
          return result;
        }

        if (typeof result === "object" && result !== null && typeof (result as { StatusCode?: unknown }).StatusCode === "number") {
          return (result as { StatusCode: number }).StatusCode;
        }

        return 1;
      });

    try {
      return await Promise.race([waitPromise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private parseTrivyVulnerabilities(output: string): DockerVulnerabilityEntry[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      return [];
    }

    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }

    const results = Array.isArray((parsed as { Results?: unknown }).Results)
      ? ((parsed as { Results: unknown[] }).Results)
      : [];

    const vulnerabilities: DockerVulnerabilityEntry[] = [];

    for (const result of results) {
      if (typeof result !== "object" || result === null) {
        continue;
      }

      const records = Array.isArray((result as { Vulnerabilities?: unknown }).Vulnerabilities)
        ? ((result as { Vulnerabilities: unknown[] }).Vulnerabilities)
        : [];

      for (const record of records) {
        const normalized = this.normalizeScannerVulnerability(record, "trivy");
        if (normalized) {
          vulnerabilities.push(normalized);
        }
      }
    }

    return vulnerabilities;
  }

  private parseGrypeVulnerabilities(output: string): DockerVulnerabilityEntry[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      return [];
    }

    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }

    const matches = Array.isArray((parsed as { matches?: unknown }).matches)
      ? ((parsed as { matches: unknown[] }).matches)
      : [];

    const vulnerabilities: DockerVulnerabilityEntry[] = [];

    for (const match of matches) {
      const normalized = this.normalizeScannerVulnerability(match, "grype");
      if (normalized) {
        vulnerabilities.push(normalized);
      }
    }

    return vulnerabilities;
  }

  private normalizeScannerVulnerability(
    raw: unknown,
    scanner: "trivy" | "grype",
  ): DockerVulnerabilityEntry | null {
    if (typeof raw !== "object" || raw === null) {
      return null;
    }

    const severity = this.normalizeSeverity(
      scanner === "trivy"
        ? (raw as { Severity?: unknown }).Severity
        : (raw as { vulnerability?: { severity?: unknown } }).vulnerability?.severity,
    );

    if (!severity) {
      return null;
    }

    if (scanner === "trivy") {
      const vulnerabilityId = this.toNonEmptyString((raw as { VulnerabilityID?: unknown }).VulnerabilityID);
      const packageName = this.toNonEmptyString((raw as { PkgName?: unknown }).PkgName);
      const installedVersion = this.toNonEmptyString((raw as { InstalledVersion?: unknown }).InstalledVersion);
      const fixedVersion = this.toOptionalNonEmptyString((raw as { FixedVersion?: unknown }).FixedVersion);
      const description = this.toNonEmptyString((raw as { Description?: unknown }).Description)
        ?? this.toNonEmptyString((raw as { Title?: unknown }).Title)
        ?? `${packageName ?? "package"} vulnerability`;
      const layerDigest = this.extractTrivyLayerDigest(raw);

      if (!vulnerabilityId || !packageName || !installedVersion) {
        return null;
      }

      return {
        id: vulnerabilityId,
        severity,
        packageName,
        currentVersion: installedVersion,
        fixedVersion,
        description,
        layerId: layerDigest ?? undefined,
        layerDigest: layerDigest ?? undefined,
        scannerSources: [scanner],
      };
    }

    const vulnerability = (raw as { vulnerability?: unknown }).vulnerability;
    const artifact = (raw as { artifact?: unknown }).artifact;

    if (typeof vulnerability !== "object" || vulnerability === null) {
      return null;
    }

    const vulnerabilityId = this.toNonEmptyString((vulnerability as { id?: unknown }).id);
    const packageName =
      (typeof artifact === "object" && artifact !== null
        ? this.toNonEmptyString((artifact as { name?: unknown }).name)
        : null)
      ?? "unknown-package";
    const installedVersion =
      (typeof artifact === "object" && artifact !== null
        ? this.toNonEmptyString((artifact as { version?: unknown }).version)
        : null)
      ?? "unknown";

    if (!vulnerabilityId) {
      return null;
    }

    const fix = (vulnerability as { fix?: unknown }).fix;
    const fixedVersion =
      typeof fix === "object" && fix !== null && Array.isArray((fix as { versions?: unknown }).versions)
        ? this.toOptionalNonEmptyString(((fix as { versions: unknown[] }).versions[0]))
        : null;

    const description = this.toNonEmptyString((vulnerability as { description?: unknown }).description)
      ?? this.toNonEmptyString((vulnerability as { dataSource?: unknown }).dataSource)
      ?? `${packageName} vulnerability`;
    const layerDigest = this.extractGrypeLayerDigest(raw);

    return {
      id: vulnerabilityId,
      severity,
      packageName,
      currentVersion: installedVersion,
      fixedVersion,
      description,
      layerId: layerDigest ?? undefined,
      layerDigest: layerDigest ?? undefined,
      scannerSources: [scanner],
    };
  }

  private mergeVulnerabilityEntries(entries: DockerVulnerabilityEntry[]): DockerVulnerabilityEntry[] {
    const severityRank: Record<DockerVulnerabilityEntry["severity"], number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    const merged = new Map<string, DockerVulnerabilityEntry>();
    for (const entry of entries) {
      const key = `${entry.id}::${entry.packageName}::${entry.currentVersion}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, entry);
        continue;
      }

      const scannerSources = [...new Set([...(existing.scannerSources ?? []), ...(entry.scannerSources ?? [])])];

      const withSources = (source: DockerVulnerabilityEntry): DockerVulnerabilityEntry => ({
        ...source,
        scannerSources,
      });

      if (severityRank[entry.severity] > severityRank[existing.severity]) {
        merged.set(key, withSources(entry));
        continue;
      }

      const fixedVersion = existing.fixedVersion ?? entry.fixedVersion;
      const description = existing.description.length >= entry.description.length
        ? existing.description
        : entry.description;
      const layerDigest = existing.layerDigest ?? entry.layerDigest;
      const layerId = existing.layerId ?? entry.layerId;

      merged.set(
        key,
        withSources({
          ...existing,
          fixedVersion,
          description,
          layerDigest,
          layerId,
        }),
      );
    }

    return [...merged.values()].sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
  }

  private normalizeSeverity(value: unknown): DockerVulnerabilityEntry["severity"] | null {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") {
      return normalized;
    }

    return null;
  }

  private toNonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private toOptionalNonEmptyString(value: unknown): string | null {
    return this.toNonEmptyString(value);
  }

  private normalizeLayerDigest(value: unknown): string | null {
    const normalized = this.toNonEmptyString(value);
    if (!normalized) {
      return null;
    }

    return normalized.toLowerCase();
  }

  private extractTrivyLayerDigest(raw: unknown): string | null {
    if (typeof raw !== "object" || raw === null) {
      return null;
    }

    const layer = (raw as { Layer?: unknown }).Layer;
    if (typeof layer === "string") {
      return this.normalizeLayerDigest(layer);
    }

    if (typeof layer === "object" && layer !== null) {
      const layerCandidate =
        this.normalizeLayerDigest((layer as { DiffID?: unknown }).DiffID)
        ?? this.normalizeLayerDigest((layer as { Digest?: unknown }).Digest)
        ?? this.normalizeLayerDigest((layer as { LayerID?: unknown }).LayerID)
        ?? this.normalizeLayerDigest((layer as { ID?: unknown }).ID);

      if (layerCandidate) {
        return layerCandidate;
      }
    }

    return (
      this.normalizeLayerDigest((raw as { LayerID?: unknown }).LayerID)
      ?? this.normalizeLayerDigest((raw as { LayerDigest?: unknown }).LayerDigest)
      ?? null
    );
  }

  private extractGrypeLayerDigest(raw: unknown): string | null {
    if (typeof raw !== "object" || raw === null) {
      return null;
    }

    const artifact = (raw as { artifact?: unknown }).artifact;
    if (typeof artifact !== "object" || artifact === null) {
      return null;
    }

    const locations = Array.isArray((artifact as { locations?: unknown }).locations)
      ? ((artifact as { locations: unknown[] }).locations)
      : [];

    for (const location of locations) {
      if (typeof location !== "object" || location === null) {
        continue;
      }

      const digest =
        this.normalizeLayerDigest((location as { layerID?: unknown }).layerID)
        ?? this.normalizeLayerDigest((location as { layerId?: unknown }).layerId)
        ?? this.normalizeLayerDigest((location as { layerDigest?: unknown }).layerDigest)
        ?? this.normalizeLayerDigest((location as { digest?: unknown }).digest);

      if (digest) {
        return digest;
      }
    }

    return null;
  }

  private splitScannerOutputLines(output: string): string[] {
    return output
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private buildScanEvent(input: BuildScanEventInput): DockerImageSecurityScanEvent {
    const base = {
      imageId: input.imageId,
      timestamp: new Date().toISOString(),
      stage: input.stage,
      scanner: input.scanner,
      message: input.message,
      progress: input.progress,
      logLine: input.logLine,
      scannerResult: input.scannerResult,
      scanSummary: input.scanSummary,
      vulnerabilities: input.vulnerabilities,
    } as const;

    switch (input.type) {
      case "status":
        return {
          ...base,
          type: "status",
          payload: {
            stage: input.stage,
            progress: input.progress,
            message: input.message,
          },
        };
      case "log":
        return {
          ...base,
          type: "log",
          payload: {
            line: input.logLine ?? input.message,
          },
        };
      case "result":
        return {
          ...base,
          type: "result",
          payload: {
            scannerResult: input.scannerResult ?? {
              scanner: input.scanner ?? "trivy",
              status: "unavailable",
              findingsCount: 0,
              durationMs: null,
              executedAt: new Date().toISOString(),
              error: null,
            },
          },
        };
      case "complete":
        return {
          ...base,
          type: "complete",
          payload: {
            scanSummary: input.scanSummary ?? {
              cached: false,
              scannedAt: new Date().toISOString(),
              totalFindings: input.vulnerabilities?.length ?? 0,
              scanners: input.scannerResult ? [input.scannerResult] : [],
              layerEfficiency: null,
            },
            vulnerabilities: input.vulnerabilities ?? [],
          },
        };
      case "error":
        return {
          ...base,
          type: "error",
          payload: {
            error: input.logLine ?? input.message,
            scannerResult: input.scannerResult ?? null,
          },
        };
    }
  }

  private parseDiveLayerEfficiency(output: string): DockerImageLayerEfficiency | null {
    const normalizedOutput = output.trim();
    if (normalizedOutput.length === 0) {
      return null;
    }

    const efficiencyMatch = /(?:image\s+efficiency\s+score|efficiency(?:\s+score)?)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*%?/iu.exec(normalizedOutput);
    const wastedPercentMatch = /(?:wasted\s+space|wasted)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*%/iu.exec(normalizedOutput);
    const wastedSizeMatch = /(?:potential\s+wasted\s+space|wasted\s+bytes?)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*([kmgtep]?i?b)/iu.exec(normalizedOutput);

    const efficiencyScore = efficiencyMatch ? Number(efficiencyMatch[1]) : null;
    const estimatedWastedPercent = wastedPercentMatch ? Number(wastedPercentMatch[1]) : null;
    const estimatedWastedBytes = wastedSizeMatch?.[1] && wastedSizeMatch?.[2]
      ? this.parseByteValue(wastedSizeMatch[1], wastedSizeMatch[2])
      : null;

    const notes = normalizedOutput
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => /efficiency|wasted|layer/iu.test(line))
      .slice(0, 4);

    if (
      efficiencyScore === null
      && estimatedWastedPercent === null
      && estimatedWastedBytes === null
      && notes.length === 0
    ) {
      return null;
    }

    return {
      efficiencyScore,
      estimatedWastedPercent,
      estimatedWastedBytes,
      notes,
    };
  }

  private parseByteValue(rawValue: string, rawUnit: string): number | null {
    const value = Number(rawValue);
    if (Number.isNaN(value) || value < 0) {
      return null;
    }

    const unit = rawUnit.trim().toLowerCase();
    const multipliers: Record<string, number> = {
      b: 1,
      kb: 1_000,
      mb: 1_000_000,
      gb: 1_000_000_000,
      tb: 1_000_000_000_000,
      pb: 1_000_000_000_000_000,
      kib: 1_024,
      mib: 1_048_576,
      gib: 1_073_741_824,
      tib: 1_099_511_627_776,
      pib: 1_125_899_906_842_624,
    };

    const multiplier = multipliers[unit];
    if (!multiplier) {
      return null;
    }

    return Math.round(value * multiplier);
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  async listImages(input: DockerImageListInput) {
    const docker = this.dockerService.getDockerClient();
    const rawImages = (await docker.listImages()) as unknown as Record<string, unknown>[];

    const mapped: DockerImage[] = [];

    for (const image of rawImages) {
      const imageId = typeof image.Id === "string" ? image.Id.trim() : "";
      const repoTags = ((image.RepoTags as string[] | undefined) ?? []).filter((tag) => tag && tag !== "<none>:<none>");
      const repoDigests = this.toStringArray(image.RepoDigests as string | string[] | undefined);
      const resolvedPrimaryTag = this.resolvePrimaryImageTag(repoTags, repoDigests);
      const fallbackRepository = this.buildFallbackImageRepository(imageId);
      const fallbackRegistry = "local";
      const primaryTag = resolvedPrimaryTag ?? `${fallbackRegistry}/${fallbackRepository}`;
      const parsed = resolvedPrimaryTag
        ? this.parseRegistryAndRepository(primaryTag)
        : { registry: fallbackRegistry, repository: fallbackRepository, tag: null };
      const repository = parsed.repository === "library/unknown"
        ? fallbackRepository
        : parsed.repository;

      const normalizedDigest = repoDigests
        .map((digest) => this.normalizeImageDigest(digest))
        .find((digest): digest is string => digest !== null) ?? null;

      const parsedImage = dockerImageSchema.safeParse({
        id: imageId,
        registry: parsed.registry,
        repository,
        tag: parsed.tag,
        digest: normalizedDigest,
        sizeBytes: typeof image.Size === "number" ? image.Size : null,
        createdAt:
          typeof image.Created === "number"
            ? new Date(image.Created * 1000).toISOString()
            : new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        labels: ((image.Labels as Record<string, string> | undefined) ?? {}),
      });

      if (!parsedImage.success) {
        this.logger.warn(
          `Skipping invalid docker image entry in listImages: ${JSON.stringify(parsedImage.error.issues[0] ?? null)}`,
        );
        continue;
      }

      mapped.push(parsedImage.data);
    }

    const filtered = mapped.filter((item) => {
      const registryMatch = this.matchString(item.registry, this.getFilterEntry(input, "registry"));
      const repositoryMatch = this.matchString(item.repository, this.getFilterEntry(input, "repository"));
      const tagMatch = this.matchString(item.tag ?? "", this.getFilterEntry(input, "tag"));
      return registryMatch && repositoryMatch && tagMatch;
    });

    const sorted = this.sortItems(filtered, input, (item, sortBy) => {
      switch (sortBy) {
        case "createdAt":
          return item.createdAt;
        case "registry":
          return item.registry;
        case "repository":
          return item.repository;
        case "lastSeenAt":
        default:
          return item.lastSeenAt;
      }
    });

    return this.paginate(sorted, input);
  }

  async listNetworks(input: DockerNetworkListInput) {
    const docker = this.dockerService.getDockerClient();
    const rawNetworks = (await docker.listNetworks()) as unknown as Record<string, unknown>[];

    const mapped = rawNetworks.map((network) => {
      const ipamConfig = ((network.IPAM as { Config?: Record<string, unknown>[] } | undefined)?.Config ?? [])[0] ?? {};
      const containers = Object.keys((network.Containers as Record<string, unknown> | undefined) ?? {});

      return dockerNetworkSchema.parse({
        id: String(network.Id ?? ""),
        name: String(network.Name ?? "unknown-network"),
        driver: this.normalizeNetworkDriver(String(network.Driver ?? "custom")),
        scope: this.normalizeNetworkScope(String(network.Scope ?? "global")),
        internal: Boolean(network.Internal),
        attachable: network.Attachable == null ? true : Boolean(network.Attachable),
        subnet: typeof ipamConfig.Subnet === "string" ? ipamConfig.Subnet : null,
        gateway: typeof ipamConfig.Gateway === "string" ? ipamConfig.Gateway : null,
        containerIds: containers,
        labels: ((network.Labels as Record<string, string> | undefined) ?? {}),
        createdAt:
          typeof network.Created === "string"
            ? new Date(network.Created).toISOString()
            : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    const filtered = mapped.filter((item) => {
      const nameMatch = this.matchString(item.name, this.getFilterEntry(input, "name"));
      const driverMatch = this.matchEq(item.driver, this.getFilterEntry(input, "driver"));
      const scopeMatch = this.matchEq(item.scope, this.getFilterEntry(input, "scope"));
      return nameMatch && driverMatch && scopeMatch;
    });

    const sorted = this.sortItems(filtered, input, (item, sortBy) => {
      switch (sortBy) {
        case "name":
          return item.name;
        case "createdAt":
          return item.createdAt;
        case "updatedAt":
        default:
          return item.updatedAt;
      }
    });

    return this.paginate(sorted, input);
  }

  async listVolumes(input: DockerVolumeListInput) {
    const docker = this.dockerService.getDockerClient();
    const [volumesResult, rawContainers] = await Promise.all([
      docker.listVolumes(),
      this.listRawContainers(),
    ]);

    const usedByVolume = new Map<string, string[]>();
    for (const container of rawContainers) {
      const containerId = String(container.Id ?? "");
      const mounts = (container.Mounts as Record<string, unknown>[] | undefined) ?? [];
      for (const mount of mounts) {
        const volumeName = typeof mount.Name === "string" ? mount.Name : undefined;
        if (!volumeName) continue;
        const current = usedByVolume.get(volumeName) ?? [];
        current.push(containerId);
        usedByVolume.set(volumeName, current);
      }
    }

    const rawVolumes = (volumesResult.Volumes ?? []) as unknown as Record<string, unknown>[];

    const mapped = rawVolumes.map((volume) =>
      dockerVolumeSchema.parse({
        id: String(volume.Name ?? volume.Driver ?? "unknown-volume"),
        name: String(volume.Name ?? "unknown-volume"),
        driver: ["local", "nfs", "csi", "tmpfs"].includes(String(volume.Driver ?? "local"))
          ? (String(volume.Driver ?? "local") as DockerVolume["driver"])
          : "custom",
        mountpoint: typeof volume.Mountpoint === "string" ? volume.Mountpoint : null,
        sizeBytes:
          typeof (volume.UsageData as { Size?: unknown } | undefined)?.Size === "number"
            ? ((volume.UsageData as { Size: number }).Size)
            : null,
        usedByContainerIds: usedByVolume.get(String(volume.Name ?? "")) ?? [],
        labels: ((volume.Labels as Record<string, string> | undefined) ?? {}),
        createdAt:
          typeof volume.CreatedAt === "string"
            ? new Date(volume.CreatedAt).toISOString()
            : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );

    const filtered = mapped.filter((item) => {
      const nameMatch = this.matchString(item.name, this.getFilterEntry(input, "name"));
      const driverMatch = this.matchEq(item.driver, this.getFilterEntry(input, "driver"));
      return nameMatch && driverMatch;
    });

    const sorted = this.sortItems(filtered, input, (item, sortBy) => {
      switch (sortBy) {
        case "name":
          return item.name;
        case "createdAt":
          return item.createdAt;
        case "updatedAt":
        default:
          return item.updatedAt;
      }
    });

    return this.paginate(sorted, input);
  }

  async listRegistries(input: DockerRegistryListInput) {
    const images = await this.listImages({
      limit: 10_000,
      offset: 0,
      sortBy: "lastSeenAt",
      sortDirection: "desc",
      filter: {},
    });

    const grouped = new Map<string, { repositories: Set<string>; lastSeenAt: string }>();

    for (const image of images.data) {
      const current = grouped.get(image.registry) ?? {
        repositories: new Set<string>(),
        lastSeenAt: image.lastSeenAt,
      };
      current.repositories.add(image.repository);
      if (image.lastSeenAt > current.lastSeenAt) {
        current.lastSeenAt = image.lastSeenAt;
      }
      grouped.set(image.registry, current);
    }

    const mapped = [...grouped.entries()].map(([registry, value]) =>
      dockerRegistrySchema.parse({
        id: registry,
        name: registry,
        url: registry,
        authMode: "anonymous",
        status: "unknown",
        isPrimary: registry === "docker.io",
        repositories: [...value.repositories].sort(),
        lastSyncedAt: value.lastSeenAt,
        createdAt: value.lastSeenAt,
        updatedAt: value.lastSeenAt,
      }),
    );

    const filtered = mapped.filter((item) => {
      const nameMatch = this.matchString(item.name, this.getFilterEntry(input, "name"));
      const statusMatch = this.matchEq(item.status, this.getFilterEntry(input, "status"));
      const primaryMatch = this.matchEq(item.isPrimary, this.getFilterEntry(input, "isPrimary"));
      return nameMatch && statusMatch && primaryMatch;
    });

    const sorted = this.sortItems(filtered, input, (item, sortBy) => {
      switch (sortBy) {
        case "name":
          return item.name;
        case "url":
          return item.url;
        case "createdAt":
          return item.createdAt;
        case "updatedAt":
        default:
          return item.updatedAt;
      }
    });

    return this.paginate(sorted, input);
  }

  async listStacks(input: DockerStackListInput) {
    const rawContainers = await this.listRawContainers();

    const groupedByStack = new Map<string, DockerStack>();

    for (const container of rawContainers) {
      const labels = (container.Labels as Record<string, string> | undefined) ?? {};
      const stackName =
        labels["com.docker.compose.project"] ??
        labels["com.docker.stack.namespace"] ??
        "standalone";
      const context: DeploymentContext | undefined = undefined;

      const containerId = String(container.Id ?? "");
      const containerStatus = this.normalizeContainerStatus(String(container.State ?? "unknown"));
      const name = String((container.Names as string[] | undefined)?.[0] ?? "").replace(/^\//, "") || String(container.Id ?? "unknown-container");
      const serviceId = this.resolveContainerServiceId(context, labels, name, containerId);
      const projectId = this.resolveContainerProjectId(context, labels, serviceId, name);

      const existing = groupedByStack.get(stackName);
      const serviceRef = {
        serviceId,
        imageId: String(container.ImageID ?? "") || null,
        containerIds: [containerId],
        networkIds: Object.keys(
          ((container.NetworkSettings as { Networks?: Record<string, unknown> } | undefined)?.Networks ?? {}),
        ),
        volumeIds: ((container.Mounts as Record<string, unknown>[] | undefined) ?? [])
          .map((mount) => (typeof mount.Name === "string" ? mount.Name : null))
          .filter((value): value is string => value !== null),
        replicas: 1,
        desiredReplicas: 1,
        status: containerStatus,
      } as const;

      if (!existing) {
        groupedByStack.set(
          stackName,
          dockerStackSchema.parse({
            id: stackName,
            name: stackName,
            projectId,
            status:
              containerStatus === "running"
                ? "healthy"
                : containerStatus === "exited" || containerStatus === "dead"
                  ? "failed"
                  : "degraded",
            services: [serviceRef],
            networkIds: [...serviceRef.networkIds],
            volumeIds: [...serviceRef.volumeIds],
            labels: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        );
        continue;
      }

      const nextStatus =
        existing.status === "failed" || containerStatus === "dead" || containerStatus === "exited"
          ? "failed"
          : existing.status;

      groupedByStack.set(
        stackName,
        dockerStackSchema.parse({
          ...existing,
          status: nextStatus,
          services: [...existing.services, serviceRef],
          networkIds: [...new Set([...existing.networkIds, ...serviceRef.networkIds])],
          volumeIds: [...new Set([...existing.volumeIds, ...serviceRef.volumeIds])],
          updatedAt: new Date().toISOString(),
        }),
      );
    }

    const mapped = [...groupedByStack.values()];

    const filtered = mapped.filter((item) => {
      const nameMatch = this.matchString(item.name, this.getFilterEntry(input, "name"));
      const statusMatch = this.matchEq(item.status, this.getFilterEntry(input, "status"));
      const projectMatch = this.matchEq(item.projectId, this.getFilterEntry(input, "projectId"));
      return nameMatch && statusMatch && projectMatch;
    });

    const sorted = this.sortItems(filtered, input, (item, sortBy) => {
      switch (sortBy) {
        case "name":
          return item.name;
        case "projectId":
          return item.projectId;
        case "createdAt":
          return item.createdAt;
        case "updatedAt":
        default:
          return item.updatedAt;
      }
    });

    return this.paginate(sorted, input);
  }

  async getRuntimeCatalogSnapshot(): Promise<DockerRuntimeCatalog> {
    const [containers, images, networks, volumes, registries, stacks] = await Promise.all([
      this.listContainers({
        limit: 500,
        offset: 0,
        sortBy: "updatedAt",
        sortDirection: "desc",
        filter: {},
      }),
      this.listImages({
        limit: 500,
        offset: 0,
        sortBy: "lastSeenAt",
        sortDirection: "desc",
        filter: {},
      }),
      this.listNetworks({
        limit: 500,
        offset: 0,
        sortBy: "updatedAt",
        sortDirection: "desc",
        filter: {},
      }),
      this.listVolumes({
        limit: 500,
        offset: 0,
        sortBy: "updatedAt",
        sortDirection: "desc",
        filter: {},
      }),
      this.listRegistries({
        limit: 500,
        offset: 0,
        sortBy: "updatedAt",
        sortDirection: "desc",
        filter: {},
      }),
      this.listStacks({
        limit: 500,
        offset: 0,
        sortBy: "updatedAt",
        sortDirection: "desc",
        filter: {},
      }),
    ]);

    return dockerRuntimeCatalogSchema.parse({
      containers: containers.data,
      images: images.data,
      networks: networks.data,
      volumes: volumes.data,
      registries: registries.data,
      stacks: stacks.data,
    });
  }
}
