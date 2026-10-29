import { createHash } from "node:crypto";

import { Injectable, Inject, Optional, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import z from "zod/v4"

import { dockerodeContainerListSchema, dockerodeImageInspectSchema, type DockerodeContainerList, type DockerodeImageInspect } from "@deployer/contracts-entities";
import {
  dockerContainerLinkedDeploymentSchema,
  dockerContainerLinkedProjectSchema,
  dockerContainerLinkedServiceSchema,
  dockerContainerWithLinksSchema,
  dockerContainerInspectDetailSchema,
  dockerImageInspectDetailSchema,
  dockerRuntimeActivityEntitySchema,
  dockerRuntimeCatalogSchema,
  dockerRuntimeEventSchema,
  dockerStackSchema,
  type DockerContainer,
  type DockerContainerLinkPath,
  type DockerContainerWithLinks,
  type DockerContainerInspectDetail,
  type DockerImageLayerEfficiency,
  type DockerImageScannerResult,
  type DockerImageInspectDetail,
  type DockerRuntimeCatalog,
  type DockerRuntimeActivityEntity,
  type DockerRuntimeEvent,
  type DockerStack,
} from "@deployer/contracts-entities";
import { DockerEngine, DockerHost, ScannerPool, type DockerEngineShape, type DockerHostShape, type ScannerPoolShape } from "@deployer/docker";
import { CONTAINER_LINK_RESOLVER } from "@deployer/docker";
import type { ContainersShape } from "@deployer/docker";
import type { IContainerLinkResolver } from "@deployer/docker";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { projects, services } from "@deployer/nest-schema/global/project/deployment";
import { deployments } from "@deployer/nest-schema/global/runtime/deployment";
import { dockerRuntimeActivities } from "@deployer/nest-schema/global/runtime/docker-runtime-activity";
import { dockerImageSecurityLifecycle, dockerImageSecurityScanHistory, dockerImageSecurityScans } from "@deployer/nest-schema/global/runtime/docker-security-scan";
import { GlobalDatabaseService } from "@deployer/shared/core/modules/database/services/global-database.service";

import { isRecord } from "@deployer/type-guards"
import { ContainerDockerodeNormalizer } from "../../shared/container-dockerode-normalizer.service";
import type { DockerContainerListInput } from "@deployer/runtime-contracts/modules/docker/containers/shared";
import type { DockerImageListInput } from "@deployer/runtime-contracts/modules/docker/images/list";

import {
  parseRegistryAndRepository,
  resolvePrimaryImageTag,
  buildFallbackImageRepository,
  normalizeImageDigest,
} from "../images/engine/docker-image-identity";
import {
  toStringArray,
  normalizeImageIdentifier,
  buildCanonicalImageIdentifier,
  buildImageInspectCandidates,
  buildImageInspectCandidatesFromImageList,
} from "../images/engine/docker-image-reference";
import {
  DockerImagesRepository,
  makeDockerImagesRepository,
  type DockerImagesRepositoryShape,
} from "../images/engine/docker-images.repository";
import { deriveRegistries } from "../images/engine/docker-registries";
import { DockerImageScannerService } from "../images/security/docker-image-scanner.service";
import {
  buildScanEvent,
} from "../images/security/scanner-output";
import {
  DockerNetworksRepository,
  makeDockerNetworksRepository,
  type DockerNetworksRepositoryShape,
} from "../networks/docker-networks.repository";
import {
  buildRuntimeActivityRecord,
  toRuntimeActivityEntity,
} from "../runtime/runtime-activity-mapping";
import {
  DockerVolumesRepository,
  makeDockerVolumesRepository,
  type DockerVolumesRepositoryShape,
} from "../volumes/docker-volumes.repository";

import type {
  ResolvedImageSecurityScan,
  DockerImageLifecycleUpsertResult,
  RawImageSecurityScan,
  ScannerRunProgressOptions,
} from "../images/security/docker-image-scanner.types";


import type { DockerNetworkListInput } from "@deployer/runtime-contracts/modules/docker/networks/list";
import type { DockerRegistryListInput } from "@deployer/runtime-contracts/modules/docker/registries/list";
import type { DockerStackListInput } from "@deployer/runtime-contracts/modules/docker/stacks/list";
import type { DockerVolumeListInput } from "@deployer/runtime-contracts/modules/docker/volumes/list";
import type {
  DockerRuntimeActivityDetailQueryInput,
  DockerRuntimeActivityListInput,
} from "@deployer/runtime-contracts/modules/docker/runtime/activity";

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

@Injectable()
export class DockerRepository {
  private readonly logger = new Logger(DockerRepository.name);
  private localDockerDaemonId: string | null | undefined;
  private localDockerDaemonIdLoadPromise: Promise<string | null> | null = null;
  private readonly scanner: DockerImageScannerService;
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
  ) {
    this.scanner = new DockerImageScannerService(dockerEngine, scannerPool, dockerHost, {
      read: (identifiers) => this.readPersistedImageSecurityScan(identifiers),
      persist: (imageId, scan) => this.persistImageSecurityScan(imageId, scan),
    });
  }

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
    const envEntries = toStringArray(inspect.Config.Env);
    const healthcheckTest = toStringArray(inspect.Config.Healthcheck?.Test);
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
        aliases: toStringArray(networkAttachment.Aliases),
        dnsServers: toStringArray(inspect.HostConfig.Dns),
        dnsSearch: toStringArray(inspect.HostConfig.DnsSearch),
        dnsOptions: toStringArray(inspect.HostConfig.DnsOptions),
        extraHosts: toStringArray(inspect.HostConfig?.ExtraHosts),
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
      entrypoint: toStringArray(inspect.Config.Entrypoint),
      command: toStringArray(inspect.Config.Cmd),
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
          dns: toStringArray(inspect.HostConfig.Dns),
          dnsSearch: toStringArray(inspect.HostConfig.DnsSearch),
          dnsOptions: toStringArray(inspect.HostConfig.DnsOptions),
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
    const repoTags = toStringArray(inspect.RepoTags as string | string[] | undefined)
      .filter((tag) => tag !== "<none>:<none>");
    const repoDigests = toStringArray(inspect.RepoDigests);
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

    const layers = toStringArray(rootFs.Layers as string | string[] | undefined).map((layerId, index) => ({
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

    const securityScan = await this.scanner.resolveImageVulnerabilities(inspectId, vulnerabilityScanTargets, {
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
        env: toStringArray(config.Env),
        exposedPorts:
          typeof config.ExposedPorts === "object" && config.ExposedPorts !== null
            ? Object.keys(config.ExposedPorts)
            : [],
        workingDir: typeof config.WorkingDir === "string" ? config.WorkingDir : null,
        user: typeof config.User === "string" && config.User.length > 0 ? config.User : null,
        entrypoint: toStringArray(config.Entrypoint),
        command: toStringArray(config.Cmd),
      },
    });
  }

  async streamImageSecurityScan(
    imageId: string,
    options: ScannerRunProgressOptions = {},
  ): Promise<ResolvedImageSecurityScan> {
    const inspect = await this.inspectImageWithCandidates(imageId);

    const inspectId = typeof inspect.Id === "string" && inspect.Id.length > 0 ? inspect.Id : imageId;
    const repoTags = toStringArray(inspect.RepoTags as string | string[] | undefined)
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

    const scanResult = await this.scanner.scanImageVulnerabilitiesWithProgress(
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
    const repoTags = toStringArray(inspect.RepoTags as string | string[] | undefined)
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
    await this.globalDatabaseService.db
      .insert(dockerRuntimeActivities)
      .values(buildRuntimeActivityRecord(rawEvent, new Date()))
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

    const mapped = rows.map(toRuntimeActivityEntity);

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

    return toRuntimeActivityEntity(row);
  }





  private async resolveLifecycleIdentifier(imageId: string): Promise<{
    imageIdentifierNormalized: string;
  }> {
    const inspect = await this.inspectImageWithCandidates(imageId);
    const inspectId = typeof inspect.Id === "string" && inspect.Id.length > 0 ? inspect.Id : imageId;
    const repoTags = toStringArray(inspect.RepoTags as string | string[] | undefined)
      .filter((tag) => tag !== "<none>:<none>");
    const repoDigests = toStringArray(inspect.RepoDigests as string | string[] | undefined)
      .filter((digest) => digest !== "<none>@<none>");

    const primaryRef = resolvePrimaryImageTag(repoTags, repoDigests) ?? imageId;
    const parsed = parseRegistryAndRepository(primaryRef);
    const normalizedDigest = normalizeImageDigest(repoDigests[0] ?? null);

    return {
      imageIdentifierNormalized: buildCanonicalImageIdentifier({
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











  private async inspectImageWithCandidates(imageId: string): Promise<DockerodeImageInspect> {
    const candidates = buildImageInspectCandidates(imageId);

    for (const candidate of candidates) {
      const raw = await this.inspectImageOrNull(candidate);
      const parsed = dockerodeImageInspectSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }

    const images = await runPromiseUnwrapped(this.dockerEngine.images.list());

    const resolvedCandidates = buildImageInspectCandidatesFromImageList(imageId, images);

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
        .map((candidate) => normalizeImageIdentifier(candidate))
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

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
