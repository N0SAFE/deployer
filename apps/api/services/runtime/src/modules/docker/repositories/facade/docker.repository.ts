import { Injectable, Inject, Optional, Logger, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DockerEngine, DockerHost, ScannerPool, type DockerEngineShape, type DockerHostShape, type ScannerPoolShape, type ScannerType } from "@deployer/docker";
import type { ContainersShape } from "@deployer/docker";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { Cause, Effect, Exit } from "effect";
import { GlobalDatabaseService } from "@deployer/shared/core/modules/database/services/global-database.service";
import { ContainerDockerodeNormalizer } from "../../shared/container-dockerode-normalizer.service";
import { CONTAINER_LINK_RESOLVER } from "@deployer/docker";
import type { IContainerLinkResolver } from "@deployer/docker";
import { dockerImageSecurityLifecycle, dockerImageSecurityScanHistory, dockerImageSecurityScans } from "@deployer/nest-schema/global/runtime/docker-security-scan";
import { dockerRuntimeActivities } from "@deployer/nest-schema/global/runtime/docker-runtime-activity";
import { deployments } from "@deployer/nest-schema/global/runtime/deployment";
import { projects, services } from "@deployer/nest-schema/global/project/deployment";
import type { DockerContainerListInput } from "@deployer/runtime-contracts/modules/docker/containers/shared";
import type { DockerImageListInput } from "@deployer/runtime-contracts/modules/docker/images/list";
import { dockerodeContainerListSchema, dockerodeImageSummarySchema, dockerodeImageInspectSchema, dockerodeNetworkSummarySchema, dockerodeVolumeListResponseSchema, type DockerodeContainerList, type DockerodeImageSummary, type DockerodeImageInspect, type DockerodeNetworkSummary, type DockerodeVolumeEntry } from "@deployer/contracts-entities";
import z from "zod/v4"
import { isRecord } from "@deployer/type-guards"
import {
  parseRegistryAndRepository,
  resolvePrimaryImageTag,
  buildFallbackImageRepository,
  normalizeImageRegistrySegment,
  normalizeImageRepositoryPath,
  normalizeImageTag,
  normalizeImageDigest,
  isPlaceholderImageSegment,
} from "../images/engine/docker-image-identity";

import {
  DockerNetworksRepository,
  makeDockerNetworksRepository,
  type DockerNetworksRepositoryShape,
} from "../networks/docker-networks.repository";
import {
  parseTrivyVulnerabilities,
  parseGrypeVulnerabilities,
  mergeVulnerabilityEntries,
  splitScannerOutputLines,
  buildScanEvent,
  parseDiveLayerEfficiency,
} from "../images/security/scanner-output";
import { deriveRegistries } from "../images/engine/docker-registries";
import {
  DockerImagesRepository,
  makeDockerImagesRepository,
  type DockerImagesRepositoryShape,
} from "../images/engine/docker-images.repository";
import {
  DockerVolumesRepository,
  makeDockerVolumesRepository,
  type DockerVolumesRepositoryShape,
} from "../volumes/docker-volumes.repository";
import type { DockerNetworkListInput } from "@deployer/runtime-contracts/modules/docker/networks/list";
import type { DockerRegistryListInput } from "@deployer/runtime-contracts/modules/docker/registries/list";
import type { DockerStackListInput } from "@deployer/runtime-contracts/modules/docker/stacks/list";
import type { DockerVolumeListInput } from "@deployer/runtime-contracts/modules/docker/volumes/list";
import type {
  DockerRuntimeActivityDetailQueryInput,
  DockerRuntimeActivityListInput,
} from "@deployer/runtime-contracts/modules/docker/runtime/activity";
import {
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
} from "@deployer/contracts-entities";

type ParsedFilterEntry = { operator: string; value: unknown }

type ContractFilterKeys<TInput> = Extract<
  keyof NonNullable<TInput extends { filter?: infer TFilter } ? TFilter : never>,
  string
>;

type PaginatedListInput = {
  limit: number;
  offset: number;
}

type SortableListInput = {
  sortBy?: string;
  sortDirection?: "asc" | "desc";
}

type ResolvedContainerOwnership = {
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

type ContainerLinkedDeploymentRecord = {
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

type ContainerLinkedServiceRecord = {
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

type ContainerLinkedProjectRecord = {
  id: string;
  name: string;
  baseDomain: string | null;
  updatedAt: Date;
}

const VULNERABILITY_SCAN_TIMEOUT_MS = 120_000;
const VULNERABILITY_LOG_POLL_INTERVAL_MS = 500;
const VULNERABILITY_LOG_TAIL = 10_000;
const DEFAULT_IMAGE_SCAN_SCANNER_PARALLELISM = 3;

type ResolvedImageSecurityScan = {
  vulnerabilities: DockerImageInspectDetail["vulnerabilities"];
  scanSummary: DockerImageInspectDetail["scanSummary"];
}

type DockerImageLifecycleRecord = {
  imageIdentifierNormalized: string;
  currentGeneration: number;
  lifecycleState: "alive" | "deleted";
}

type DockerImageLifecycleUpsertResult = {
  imageIdentifierNormalized: string;
  imageGeneration: number;
  revived: boolean;
}

type RawImageSecurityScan = {
  vulnerabilities: DockerImageInspectDetail["vulnerabilities"];
  scanSummary: Omit<NonNullable<DockerImageInspectDetail["scanSummary"]>, "cached">;
}

type ScannerRunResult = {
  vulnerabilities: DockerVulnerabilityEntry[];
  scannerResult: DockerImageScannerResult;
  layerEfficiency: DockerImageLayerEfficiency | null;
}

type ScannerRunProgressOptions = {
  logPollIntervalMs?: number;
  onEvent?: (event: DockerImageSecurityScanEvent) => void;
  imageId?: string;
}

type ScannerExecutionResult = {
  scanner: "trivy" | "grype" | "dive";
  exitCode: number;
  output: string;
  durationMs: number;
  executedAt: string;
}

type ScannerExecutionConfig = {
  scanner: "trivy" | "grype" | "dive";
  image: string;
  command: string[];
}

type ScannerExecutionProgressOptions = {
  logPollIntervalMs?: number;
  onLogLine?: (line: string) => void;
  onPullLogLine?: (line: string) => void;
}

@Injectable()
export class DockerRepository {
  private readonly logger = new Logger(DockerRepository.name);
  private localDockerDaemonId: string | null | undefined;
  private localDockerDaemonIdLoadPromise: Promise<string | null> | null = null;
  private readonly imageVulnerabilityScansInFlight = new Map<string, Promise<RawImageSecurityScan>>();
  private hasWarnedMissingSecurityScanTable = false;

  constructor(
    @Inject(DockerEngine) private readonly dockerEngine: DockerEngineShape,
    @Inject(ScannerPool) private readonly scannerPool: ScannerPoolShape,
    @Inject(DockerHost) private readonly dockerHost: DockerHostShape,
    private readonly globalDatabaseService: GlobalDatabaseService,
    private readonly normalizer: ContainerDockerodeNormalizer,
    @Optional() @Inject(CONTAINER_LINK_RESOLVER)
    private readonly linkResolver?: IContainerLinkResolver,
    @Inject(DockerNetworksRepository) private readonly networks: DockerNetworksRepositoryShape = makeDockerNetworksRepository(dockerEngine),
    @Inject(DockerVolumesRepository) private readonly volumes: DockerVolumesRepositoryShape = makeDockerVolumesRepository(dockerEngine),
    @Inject(DockerImagesRepository) private readonly images: DockerImagesRepositoryShape = makeDockerImagesRepository(dockerEngine),
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
        const daemonId = await runPromiseUnwrapped(
          this.dockerEngine.info().pipe(
            Effect.map((info) => (typeof info.ID === "string" && info.ID.trim().length > 0 ? info.ID.trim() : null)),
            // An unreachable engine simply has no daemon id.
            Effect.orElseSucceed(() => null),
          ),
        );

        this.localDockerDaemonId = daemonId;
        return daemonId;
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

    const rawEntry = Reflect.get(filter, key);
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

    // Use `in` + `typeof` narrowing instead of a `Record<string, unknown>`
    // cast — the truth comes from the runtime check, not a type lie.
    const memory =
      "memory" in value && typeof value.memory === "string" ? value.memory : undefined;
    const cpu =
      "cpu" in value && typeof value.cpu === "string" ? value.cpu : undefined;
    const storage =
      "storage" in value && typeof value.storage === "string"
        ? value.storage
        : undefined;

    if (!memory && !cpu && !storage) {
      return null;
    }

    return { memory, cpu, storage };
  }

  private normalizeEnvironmentVariables(value: unknown): Record<string, string> | null {
    // Shape validation through Zod — a record keyed by non-empty strings.
    const parsed = z.record(z.string().min(1), z.string()).safeParse(value);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return null;
    }
    return parsed.data;
  }

  private normalizeCustomDomains(value: unknown): string[] {
    // Shape validation through Zod — array of non-empty strings.
    const parsed = z.array(z.string().min(1)).safeParse(value);
    return parsed.success ? parsed.data : [];
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
    const deploymentRows =
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

  private async listRawContainers(): Promise<DockerodeContainerList[]> {
    const raw = await runPromiseUnwrapped(this.dockerEngine.containers.list({ all: true }));
    const result = dockerodeContainerListSchema.array().safeParse(raw);
    if (result.success) {
      return result.data;
    }
    // Fallback: coerce each item individually, dropping invalid ones
    return raw
      .filter((item: unknown) => dockerodeContainerListSchema.safeParse(item).success)
      .map((item: unknown) => dockerodeContainerListSchema.parse(item));
  }

  async listContainers(input: DockerContainerListInput) {
    const rawContainers = await this.listRawContainers();

    const mapped = rawContainers.map((container) => {
      const labels = container.Labels;
      const rawName = container.Names[0]?.replace(/^\//, "") ?? ""
      const rawId = container.Id
      const rawImage = container.Image ?? "unknown-image"

      const enrichment = this.linkResolver?.resolveEnrichment(
        labels,
        rawName || rawId,
        rawId,
        rawImage,
        labels["deployer.network_mode"] ?? null,
      ) ?? {
        projectId: labels["com.docker.compose.project"] ?? rawId,
        serviceId: labels["com.docker.compose.service"] ?? rawId,
        environment: null,
        managedBy: "orphan" as const,
        managedReason: null,
        managedDeploymentId: null,
        managedServiceId: null,
        managedProjectId: null,
        managedImageRef: null,
        managedNetworkMode: null,
        logsStreamId: null,
      };

      return this.normalizer.normalizeContainer(container, enrichment);
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
    if (!isRecord(source)) {
      return [];
    }

    const rootFsCandidate = (() => {
      if (isRecord(source.RootFS)) {
        return source.RootFS;
      }

      if (isRecord(source.RootFs)) {
        return source.RootFs;
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
    // The engine's own description of a container, whichever dockerode typings are in scope.
    let inspect: Effect.Success<ReturnType<ContainersShape["inspect"]>>;
    try {
      inspect = await runPromiseUnwrapped(this.dockerEngine.containers.inspect(containerId));
    } catch {
      throw new NotFoundException(`Container '${containerId}' not found`);
    }

    const generatedAt = new Date().toISOString();
    const labels = inspect.Config?.Labels ?? {};
    const envEntries = this.toStringArray(inspect.Config.Env);
    const healthcheckTest = this.toStringArray(inspect.Config.Healthcheck?.Test);
    const healthcheckCommand =
      healthcheckTest.length > 1
        ? healthcheckTest.slice(1).join(" ")
        : (healthcheckTest[0] ?? null);

    const networkConfig = Object.entries(inspect.NetworkSettings.Networks ?? {}).map(
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
        dnsServers: this.toStringArray(inspect.HostConfig.Dns),
        dnsSearch: this.toStringArray(inspect.HostConfig.DnsSearch),
        dnsOptions: this.toStringArray(inspect.HostConfig.DnsOptions),
        extraHosts: this.toStringArray(inspect.HostConfig?.ExtraHosts),
      }),
    );

    const portMappings = Object.entries(inspect.NetworkSettings.Ports).flatMap(
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
      user: inspect.Config.User || null,
      workingDir: inspect.Config.WorkingDir || null,
      entrypoint: this.toStringArray(inspect.Config.Entrypoint),
      command: this.toStringArray(inspect.Config.Cmd),
      restartPolicy: inspect.HostConfig.RestartPolicy?.Name || "no",
      restartMaxRetries:
        typeof inspect.HostConfig.RestartPolicy?.MaximumRetryCount === "number"
        && inspect.HostConfig.RestartPolicy.MaximumRetryCount > 0
          ? inspect.HostConfig.RestartPolicy.MaximumRetryCount
          : null,
      privileged: Boolean(inspect.HostConfig.Privileged),
      readOnlyRootFs: Boolean(inspect.HostConfig.ReadonlyRootfs),
      oomKillDisable: Boolean(inspect.HostConfig.OomKillDisable),
      ipcMode: inspect.HostConfig.IpcMode || null,
      pidMode: inspect.HostConfig.PidMode || null,
      networkMode: inspect.HostConfig.NetworkMode || null,
      cgroupnsMode:
        isRecord(inspect.HostConfig) && inspect.HostConfig.CgroupnsMode &&
        typeof Reflect.get(inspect.HostConfig, "CgroupnsMode") === "string"
          ? (Reflect.get(inspect.HostConfig, "CgroupnsMode") as string)
          : null,
      watchMode: this.detectWatchModeFromLabels(labels),
      healthcheckCommand,
      healthcheckIntervalSec: this.toHealthcheckSeconds(inspect.Config.Healthcheck?.Interval),
      healthcheckTimeoutSec: this.toHealthcheckSeconds(inspect.Config.Healthcheck?.Timeout),
      healthcheckRetries: inspect.Config.Healthcheck?.Retries ?? null,
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
          dns: this.toStringArray(inspect.HostConfig.Dns),
          dnsSearch: this.toStringArray(inspect.HostConfig.DnsSearch),
          dnsOptions: this.toStringArray(inspect.HostConfig.DnsOptions),
          memLimitMb:
            typeof inspect.HostConfig.Memory === "number" && inspect.HostConfig.Memory > 0
              ? Math.round(inspect.HostConfig.Memory / (1024 * 1024))
              : null,
          memReservationMb:
            typeof inspect.HostConfig.MemoryReservation === "number" && inspect.HostConfig.MemoryReservation > 0
              ? Math.round(inspect.HostConfig.MemoryReservation / (1024 * 1024))
              : null,
          cpus:
            typeof inspect.HostConfig.NanoCpus === "number" && inspect.HostConfig.NanoCpus > 0
              ? Number((inspect.HostConfig.NanoCpus / 1_000_000_000).toFixed(2))
              : null,
          cpuShares:
            typeof inspect.HostConfig.CpuShares === "number" && inspect.HostConfig.CpuShares > 0
              ? inspect.HostConfig.CpuShares
              : null,
          restart: inspect.HostConfig.RestartPolicy?.Name || null,
          profiles: labels["com.docker.compose.project.working_dir"] ? ["default"] : [],
          ports: Object.keys(inspect.Config.ExposedPorts ?? {}),
          volumes: Object.keys(inspect.Config.Volumes ?? {}),
          labels,
          rawYaml: [
            "services:",
            `  ${composeServiceName ?? "service"}:`,
            `    image: ${inspect.Config.Image ?? "unknown"}`,
            `    restart: ${inspect.HostConfig.RestartPolicy?.Name ?? "no"}`,
            ...Object.keys(inspect.Config.ExposedPorts ?? {}).map((port) => `    # exposed: ${port}`),
          ].join("\n"),
        }
      : null;

    let layerIds = this.extractRootFsLayers(inspect);

    if (layerIds.length === 0) {
      const imageCandidates = [inspect.Image, inspect.Config.Image]
        .filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
        .map((candidate) => candidate.trim());

      for (const imageCandidate of imageCandidates) {
        // A candidate the engine cannot inspect is skipped: layers stay empty.
        const imageInspect = await this.inspectImageOrNull(imageCandidate);
        if (imageInspect === null) continue;
        layerIds = this.extractRootFsLayers(imageInspect);
        if (layerIds.length > 0) {
          break;
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
    const repoDigests = this.toStringArray(inspect.RepoDigests);
    const resolvedPrimaryTag = resolvePrimaryImageTag(repoTags, repoDigests);
    const fallbackRepository = buildFallbackImageRepository(inspectId);
    const fallbackRegistry = "local";
    const primaryTag = resolvedPrimaryTag ?? `${fallbackRegistry}/${fallbackRepository}`;
    const parsedPrimary = resolvedPrimaryTag
      ? parseRegistryAndRepository(primaryTag)
      : { registry: fallbackRegistry, repository: fallbackRepository, tag: null };
    const repository = parsedPrimary.repository === "library/unknown"
      ? fallbackRepository
      : parsedPrimary.repository;
    const labels = isRecord(inspect.Config) && isRecord(inspect.Config.Labels)
      ? inspect.Config.Labels
      : {};

    const rootFs =
      typeof inspect.RootFS === "object" && inspect.RootFS !== null
        ? isRecord(inspect.RootFS) ? inspect.RootFS : {}
        : {};

    const config =
      typeof inspect.Config === "object" && inspect.Config !== null
        ? isRecord(inspect.Config) ? inspect.Config : {}
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
        const containerImageId = container.ImageID ?? "";
        const containerImageName = container.Image ?? "";

        if (containerImageId.length > 0 && containerImageId === inspectId) {
          return true;
        }

        return repoTags.includes(containerImageName);
      })
      .map((container) => container.Id)
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
      digest: normalizeImageDigest(repoDigests[0] ?? null),
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
        env: this.toStringArray(config.Env),
        exposedPorts:
          typeof config.ExposedPorts === "object" && config.ExposedPorts !== null
            ? Object.keys(config.ExposedPorts)
            : [],
        workingDir: typeof config.WorkingDir === "string" ? config.WorkingDir : null,
        user: typeof config.User === "string" && config.User.length > 0 ? config.User : null,
        entrypoint: this.toStringArray(config.Entrypoint),
        command: this.toStringArray(config.Cmd),
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

    options.onEvent?.(buildScanEvent({
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
        payload: isRecord(event.payload) ? event.payload : {},
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
      // Persisted rows predate the swarm enrichment (and the columns do not
      // exist in the table yet), so a rehydrated activity carries no live swarm
      // state. The LIVE stream is where enrichment applies — history is what it
      // was recorded as.
      swarmTasks: [],
      swarmService: null,
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
      swarmTasks: [],
      swarmService: null,
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

    const registry = normalizeImageRegistrySegment(input.registry).toLowerCase();
    const repository = normalizeImageRepositoryPath(input.repository).toLowerCase();
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

    const primaryRef = resolvePrimaryImageTag(repoTags, repoDigests) ?? imageId;
    const parsed = parseRegistryAndRepository(primaryRef);
    const normalizedDigest = normalizeImageDigest(repoDigests[0] ?? null);

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
      eventId: `lifecycle:${lifecycleEventType}:${payload.imageIdentifierNormalized}:${String(Date.now())}`,
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
    const payload: Record<string, unknown> = isRecord(event.payload) ? event.payload : {};
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
    const payload = isRecord(event.payload) ? event.payload : {};
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
    images: DockerodeImageSummary[],
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

  private async inspectImageWithCandidates(imageId: string): Promise<DockerodeImageInspect> {
    const candidates = this.buildImageInspectCandidates(imageId);

    for (const candidate of candidates) {
      const raw = await this.inspectImageOrNull(candidate);
      const parsed = dockerodeImageInspectSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }

    const images = await runPromiseUnwrapped(this.dockerEngine.images.list());

    const resolvedCandidates = this.buildImageInspectCandidatesFromImageList(imageId, images);

    for (const candidate of resolvedCandidates) {
      const raw = await this.inspectImageOrNull(candidate);
      const parsed = dockerodeImageInspectSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }

    throw new NotFoundException(`Image '${imageId}' not found`);
  }

  /** The engine's description of an image, or null when it cannot be inspected (missing or engine error). */
  private inspectImageOrNull(image: string) {
    return runPromiseUnwrapped(
      this.dockerEngine.images.inspect(image).pipe(Effect.orElseSucceed(() => null)),
    );
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
      this.ensureScanner("trivy"),
      this.ensureScanner("grype"),
      this.ensureScanner("dive"),
    ]);

    const [trivyResult, grypeResult, diveResult] = await this.runScannerTasksWithConcurrency(
      [
        () => this.scanUsingTrivy(scanTargets),
        () => this.scanUsingGrype(scanTargets),
        () => this.scanUsingDive(scanTargets),
      ] as const,
      this.resolveScannerParallelism(),
    );

    const mergedVulnerabilities = mergeVulnerabilityEntries([
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

      options.onEvent?.(buildScanEvent({
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

    options.onEvent?.(buildScanEvent({
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
      this.ensureScanner("trivy"),
      this.ensureScanner("grype"),
      this.ensureScanner("dive"),
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

    options.onEvent?.(buildScanEvent({
      imageId,
      type: "status",
      stage: "merging",
      scanner: null,
      progress: 90,
      message: "Merging scanner findings",
      logLine: null,
    }));

    const mergedVulnerabilities = mergeVulnerabilityEntries([
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

    options.onEvent?.(buildScanEvent({
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

      options?.onEvent?.(buildScanEvent({
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
            options?.onEvent?.(buildScanEvent({
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
            options?.onEvent?.(buildScanEvent({
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

        const vulnerabilities = parseTrivyVulnerabilities(result.output);
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

        options?.onEvent?.(buildScanEvent({
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

    options?.onEvent?.(buildScanEvent({
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

      options?.onEvent?.(buildScanEvent({
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
            options?.onEvent?.(buildScanEvent({
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
            options?.onEvent?.(buildScanEvent({
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

        const vulnerabilities = parseGrypeVulnerabilities(result.output);
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

        options?.onEvent?.(buildScanEvent({
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

    options?.onEvent?.(buildScanEvent({
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

        options?.onEvent?.(buildScanEvent({
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
              options?.onEvent?.(buildScanEvent({
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
              options?.onEvent?.(buildScanEvent({
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

          const layerEfficiency = parseDiveLayerEfficiency(result.output);
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

          options?.onEvent?.(buildScanEvent({
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

    options?.onEvent?.(buildScanEvent({
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
    return await runPromiseUnwrapped(this.dockerEngine.images.exists(image));
  }

  /**
   * Execute a scanner command inside the shared scanner container.
   * Falls back to a per-scanner ephemeral container if the shared
   * container is unavailable (e.g. image not built yet, disabled).
   */
  private async executeScannerViaSharedContainer(
    scanner: "trivy" | "grype" | "dive",
    command: string[],
    fallbackConfig: ScannerExecutionConfig,
    progressOptions: ScannerExecutionProgressOptions = {},
  ): Promise<ScannerExecutionResult> {
    const startedAt = Date.now();
    const scannerType = scanner;

    // Try shared container first
    const ready = await this.ensureScanner(scannerType);
    if (ready) {
      try {
        const result = await runPromiseUnwrapped(this.scannerPool.exec(scannerType, command));
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
        await runPromiseUnwrapped(
          this.dockerEngine.images.pull(config.image, {
            retries: 3,
            backoffMs: 2_000,
            onProgressLine: (line) => {
              const normalized = line.trim();
              if (normalized.length > 0) {
                progressOptions.onPullLogLine?.(normalized);
              }
            },
          }),
        );
      } catch (error) {
        this.logger.debug(`Unable to pre-pull scanner image ${config.image}: ${this.formatError(error)}`);
      }
    }

    const socketBind = this.dockerHost.socketBind;
    const envVars: string[] = [];

    if (socketBind) {
      const hostPath = socketBind.split(":")[0];
      envVars.push(`DOCKER_HOST=unix://${String(hostPath)}`);
    }

    const created = await runPromiseUnwrapped(this.dockerEngine.containers.create({
      Image: config.image,
      name: containerName,
      Cmd: config.command,
      Env: envVars.length > 0 ? envVars : undefined,
      HostConfig: {
        AutoRemove: false,
        Binds: socketBind ? [socketBind] : undefined,
      },
      Tty: false,
    }));

    const scannerContainerId = created.id;

    try {
      await runPromiseUnwrapped(this.dockerEngine.containers.start(scannerContainerId));

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

        const lines = splitScannerOutputLines(output);
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
        const output = await runPromiseUnwrapped(
          this.dockerEngine.logs.read(scannerContainerId, {
            stdout: true,
            stderr: true,
            tail: VULNERABILITY_LOG_TAIL,
          }),
        );
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
    const containers = this.dockerEngine.containers;
    const attempts = 3;

    /** Whether the container is gone; an engine failure other than "not found" is reported, not thrown. */
    const probe = containers.inspect(containerId).pipe(
      Effect.as<"present" | "gone">("present"),
      Effect.catchTag("DockerNotFound", () => Effect.succeed<"present" | "gone">("gone")),
    );
    const pause = (attempt: number) => Effect.promise(() => this.delay(200 * attempt));
    const note = (message: string) => Effect.sync(() => { this.logger.debug(message); });

    // Cleanup never fails the caller: a container that cannot be removed is logged and re-checked.
    const removeContainer = containers.remove(containerId).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          this.logger.error(`Failed to remove container ${containerId}: ${this.formatError(error)}`);
        }),
      ),
    );
    const describe = (cause: Cause.Cause<unknown>) => this.formatError(Cause.squash(cause));

    const cleanup = Effect.gen(function* () {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        yield* removeContainer;

        const afterRemove = yield* Effect.exit(probe);
        if (Exit.isFailure(afterRemove)) {
          yield* note(
            `Scanner container ${containerId} inspect check failed after cleanup attempt ${String(attempt)}: ${describe(afterRemove.cause)}`,
          );
          if (attempt < attempts) yield* pause(attempt);
          continue;
        }
        if (afterRemove.value === "gone") return true;

        const forced = yield* Effect.exit(containers.removeIfExists(containerId, { removeVolumes: true }));
        if (Exit.isFailure(forced)) {
          yield* note(
            `Scanner container ${containerId} force-remove attempt ${String(attempt)} failed: ${describe(forced.cause)}`,
          );
        }

        const afterForce = yield* Effect.exit(probe);
        if (Exit.isSuccess(afterForce) && afterForce.value === "gone") return true;

        if (attempt < attempts) yield* pause(attempt);
      }
      return false;
    });

    if (!(await runPromiseUnwrapped(cleanup))) {
      this.logger.warn(
        `Scanner container ${containerId} for ${scanner} still exists after cleanup retries`,
      );
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async waitForContainerExit(containerId: string, timeoutMs: number): Promise<number> {
    // Timing out interrupts the wait, which aborts the request in flight.
    return await runPromiseUnwrapped(
      this.dockerEngine.containers.wait(containerId).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () => Effect.fail(new Error(`Timed out waiting for scanner container ${containerId}`)),
        }),
      ),
    );
  }

  private ensureScanner(scanner: ScannerType): Promise<boolean> {
    return runPromiseUnwrapped(this.scannerPool.ensureRunning(scanner));
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  async listImages(input: DockerImageListInput) {
    const mapped = await runPromiseUnwrapped(this.images.list);

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
    const mapped = await runPromiseUnwrapped(this.networks.list);

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
    const mapped = await runPromiseUnwrapped(this.volumes.list);

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

    const mapped = deriveRegistries(images.data);

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

    for (const raw of rawContainers) {
      const labels = raw.Labels;
      const stackName =
        labels["com.docker.compose.project"] ??
        labels["com.docker.stack.namespace"] ??
        "standalone";

      const rawId = raw.Id;
      const rawName = raw.Names[0]?.replace(/^\//, "") ?? "";

      // Use normalizer for docker-specific conversion, link resolver for enrichment
      const enrichment = this.linkResolver?.resolveEnrichment(
        labels,
        rawName || rawId,
        rawId,
        raw.Image ?? "unknown-image",
        labels["deployer.network_mode"] ?? null,
      );
      const typed = this.normalizer.normalizeContainer(raw, enrichment ?? {
        projectId: labels["com.docker.compose.project"] ?? rawId,
        serviceId: labels["com.docker.compose.service"] ?? rawId,
        environment: null,
        managedBy: "orphan" as const,
        managedReason: null,
        managedDeploymentId: null,
        managedServiceId: null,
        managedProjectId: null,
        managedImageRef: null,
        managedNetworkMode: null,
        logsStreamId: null,
      });

      const existing = groupedByStack.get(stackName);
      const serviceRef = {
        serviceId: typed.serviceId,
        imageId: typed.imageId,
        containerIds: [typed.id],
        networkIds: typed.networkIds,
        volumeIds: typed.volumeIds,
        replicas: 1,
        desiredReplicas: 1,
        status: typed.status,
      } as const;

      if (!existing) {
        groupedByStack.set(
          stackName,
          dockerStackSchema.parse({
            id: stackName,
            name: stackName,
            projectId: typed.projectId,
            status:
              typed.status === "running"
                ? "healthy"
                : typed.status === "exited" || typed.status === "dead"
                  ? "failed"
                  : "degraded",
            services: [serviceRef],
            networkIds: [...serviceRef.networkIds],
            volumeIds: [...serviceRef.volumeIds],
            labels: {},
            createdAt: typed.createdAt,
            updatedAt: new Date().toISOString(),
          }),
        );
        continue;
      }

      const nextStatus =
        existing.status === "failed" || typed.status === "dead" || typed.status === "exited"
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
