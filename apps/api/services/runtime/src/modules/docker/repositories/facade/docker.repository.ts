
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
import { dockerImageSecurityScanHistory, dockerImageSecurityScans } from "@deployer/nest-schema/global/runtime/docker-security-scan";
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
  ImageNotFound,
  type DockerImagesRepositoryShape,
} from "../images/engine/docker-images.repository";
import { deriveRegistries } from "../images/engine/docker-registries";
import {
  buildImageInspectDetail,
  containersUsingImage,
  identifyInspectedImage,
  scanTargetsOf,
} from "../images/engine/image-inspect-detail";
import { DockerImageScannerService } from "../images/security/docker-image-scanner.service";
import {
  buildScanEvent,
} from "../images/security/scanner-output";
import {
  DockerNetworksRepository,
  type DockerNetworksRepositoryShape,
} from "../networks/docker-networks.repository";
import {
  buildRuntimeActivityRecord,
  toRuntimeActivityEntity,
} from "../runtime/runtime-activity-mapping";
import {
  DockerVolumesRepository,
  type DockerVolumesRepositoryShape,
} from "../volumes/docker-volumes.repository";

import { RuntimeDatabasePort, RuntimeDb } from "../../../../core/database/runtime-db";
import {
  DockerImageLifecycleRepository,
  type DockerImageLifecycleRepositoryShape,
} from "../images/lifecycle/docker-image-lifecycle.repository";
import {
  ContainerNotFound,
  DockerContainersRepository,
  type DockerContainersRepositoryShape,
} from "../containers/engine/docker-containers.repository";
import {
  detectWatchModeFromLabels,
  extractRootFsLayers,
  toHealthcheckSeconds,
} from "../containers/engine/container-inspect-reading";
import {
  getFilterEntry,
  matchEq,
  matchNullableStringEq,
  matchString,
  paginate,
  sortItems,
} from "../shared/list-query";
import {
  DockerRuntimeActivitiesStore,
  type DockerRuntimeActivitiesStoreShape,
} from "../runtime/docker-runtime-activities.store";
import { groupContainersIntoStacks, stackNameOf } from "../containers/stacks/stack-grouping";
import { assembleContainerLinks, inclusionOf, withoutLinks } from "../containers/links/container-link-assembly";
import {
  DockerContainerLinksLookup,
  type DockerContainerLinksLookupShape,
} from "../containers/links/docker-container-links-lookup.repository";
import {
  DockerImageScansStore,
  type DockerImageScansStoreShape,
} from "../images/security/docker-image-scans.store";
import { computeScanHash, isScanOlderThan, shouldScanGeneration, toPersistedScan } from "../images/security/scan-storage";
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



@Injectable()
export class DockerRepository {
  private readonly logger = new Logger(DockerRepository.name);
  private localDockerDaemonId: string | null | undefined;
  private localDockerDaemonIdLoadPromise: Promise<string | null> | null = null;
  private readonly scanner: DockerImageScannerService;

  constructor(
    @Inject(DockerEngine) private readonly dockerEngine: DockerEngineShape,
    @Inject(ScannerPool) private readonly scannerPool: ScannerPoolShape,
    @Inject(DockerHost) private readonly dockerHost: DockerHostShape,
    private readonly globalDatabaseService: GlobalDatabaseService,
    private readonly normalizer: ContainerDockerodeNormalizer,
    @Optional() @Inject(CONTAINER_LINK_RESOLVER)
    private readonly linkResolver?: IContainerLinkResolver,
    @Inject(DockerNetworksRepository) private readonly networks: DockerNetworksRepositoryShape = DockerNetworksRepository.live,
    @Inject(DockerVolumesRepository) private readonly volumes: DockerVolumesRepositoryShape = DockerVolumesRepository.live,
    @Inject(DockerImagesRepository) private readonly images: DockerImagesRepositoryShape = DockerImagesRepository.live,
    @Inject(DockerImageLifecycleRepository) private readonly lifecycle: DockerImageLifecycleRepositoryShape = DockerImageLifecycleRepository.live,
    @Inject(DockerContainersRepository) private readonly containers: DockerContainersRepositoryShape = DockerContainersRepository.live,
    @Inject(DockerRuntimeActivitiesStore) private readonly activities: DockerRuntimeActivitiesStoreShape = DockerRuntimeActivitiesStore.live,
    @Inject(DockerImageScansStore) private readonly scans: DockerImageScansStoreShape = DockerImageScansStore.live,
    @Inject(DockerContainerLinksLookup) private readonly linkLookup: DockerContainerLinksLookupShape = DockerContainerLinksLookup.live,
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

  private async listRawContainers(): Promise<DockerodeContainerList[]> {
    return runPromiseUnwrapped(
      this.containers.listRaw.pipe(Effect.provideService(DockerEngine, this.dockerEngine)),
    );
  }

  /** A raw engine container as the runtime's entity, enriched with its deployment/service links when a resolver is present. */
  private toDockerContainer(container: DockerodeContainerList): DockerContainer {
    const labels = container.Labels;
    const rawName = container.Names[0]?.replace(/^\//, "") ?? "";
    const rawId = container.Id;
    const rawImage = container.Image ?? "unknown-image";

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
  }

  async listContainers(input: DockerContainerListInput) {
    const rawContainers = await this.listRawContainers();

    const mapped = rawContainers.map((container) => this.toDockerContainer(container));

    const filtered = mapped.filter((item) => {
      const nameMatch = matchString(item.name, getFilterEntry(input, "name"));
      const statusMatch = matchEq(item.status, getFilterEntry(input, "status"));
      const projectMatch = matchEq(item.projectId, getFilterEntry(input, "projectId"));
      const serviceMatch = matchEq(item.serviceId, getFilterEntry(input, "serviceId"));
      const managedByMatch = matchEq(item.managedBy, getFilterEntry(input, "managedBy"));
      const managedDeploymentMatch = matchNullableStringEq(
        item.managedDeploymentId,
        getFilterEntry(input, "managedDeploymentId"),
      );
      const managedServiceMatch = matchNullableStringEq(
        item.managedServiceId,
        getFilterEntry(input, "managedServiceId"),
      );
      const managedProjectMatch = matchNullableStringEq(
        item.managedProjectId,
        getFilterEntry(input, "managedProjectId"),
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

    const sorted = sortItems(filtered, input, (item, sortBy) => {
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

    return paginate(sorted, input);
  }


  async inspectContainer(containerId: string) {
    try {
      return await runPromiseUnwrapped(
        this.containers.inspect(containerId).pipe(Effect.provideService(DockerEngine, this.dockerEngine)),
      );
    } catch (error: unknown) {
      if (error instanceof ContainerNotFound) {
        throw new NotFoundException(`Container '${containerId}' not found`);
      }
      throw error;
    }
  }

  async inspectImage(imageId: string) {
    const inspect = await this.inspectImageWithCandidates(imageId);

    const generatedAt = new Date().toISOString();
    const identity = identifyInspectedImage(inspect, imageId);

    const rawContainers = await this.listRawContainers();
    const securityScan = await this.scanner.resolveImageVulnerabilities(
      identity.inspectId,
      scanTargetsOf(identity),
      { allowFreshScan: false },
    );

    return buildImageInspectDetail({
      inspect,
      identity,
      generatedAt,
      usedByContainerIds: containersUsingImage(rawContainers, identity),
      securityScan,
    });
  }

  async streamImageSecurityScan(
    imageId: string,
    options: ScannerRunProgressOptions = {},
  ): Promise<ResolvedImageSecurityScan> {
    const inspect = await this.inspectImageWithCandidates(imageId);

    const identity = identifyInspectedImage(inspect, imageId);
    const inspectId = identity.inspectId;
    const scanTargets = scanTargetsOf(identity);

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

    const identity = identifyInspectedImage(inspect, imageId);
    const inspectId = identity.inspectId;
    const scanTargets = scanTargetsOf(identity);

    const persisted = await this.readPersistedImageSecurityScan([inspectId, ...scanTargets]);
    if (!persisted) {
      return null;
    }

    if (isScanOlderThan(persisted.scanSummary.scannedAt, options?.maxAgeMs, Date.now())) {
      return null;
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

    const lastUpdated = await this.runOnDatabase(
      this.scans.lastUpdated(lifecycle.imageIdentifierNormalized, lifecycle.imageGeneration),
    );

    return {
      imageIdentifierNormalized: lifecycle.imageIdentifierNormalized,
      imageGeneration: lifecycle.imageGeneration,
      shouldScan: shouldScanGeneration(lastUpdated, options.maxAgeMs, Date.now()),
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

    const aliveIdentifiers = await this.runOnDatabase(this.lifecycle.listAlive());

    const activeSet = new Set(normalizedActive);
    const toMarkDeleted = aliveIdentifiers.filter((identifier) => !activeSet.has(identifier));

    if (toMarkDeleted.length === 0) {
      return;
    }

    await this.runOnDatabase(this.lifecycle.markDeleted(toMarkDeleted));

    for (const deletedIdentifier of toMarkDeleted) {
      await this.emitImageLifecycleRuntimeEvent("delete", "image_deleted", {
        imageIdentifierNormalized: deletedIdentifier,
      });
    }
  }

  async persistRuntimeActivityEvent(rawEvent: DockerRuntimeEvent): Promise<void> {
    await this.runOnDatabase(this.activities.insert(buildRuntimeActivityRecord(rawEvent, new Date())));
  }

  async listRuntimeActivities(input: DockerRuntimeActivityListInput) {
    const limit = input.limit;
    const offset = input.offset;

    const rows = await this.runOnDatabase(this.activities.listRecent(5000));

    const mapped = rows.map(toRuntimeActivityEntity);

    const filtered = mapped.filter((item) => {
      const sourceFilter = getFilterEntry(input, "source");
      const actionFilter = getFilterEntry(input, "action");
      const actorIdFilter = getFilterEntry(input, "actorId");
      const statusFilter = getFilterEntry(input, "status");
      const categoryFilter = getFilterEntry(input, "category");
      const severityFilter = getFilterEntry(input, "severity");
      const stageFilter = getFilterEntry(input, "stage");
      const scannerFilter = getFilterEntry(input, "scanner");
      const flowIdFilter = getFilterEntry(input, "flowId");
      const dependsOnFlowIdFilter = getFilterEntry(input, "dependsOnFlowId");

      return matchString(item.source, sourceFilter)
        && matchString(item.action, actionFilter)
        && matchString(item.actorId ?? "", actorIdFilter)
        && matchString(item.status, statusFilter)
        && matchString(item.category, categoryFilter)
        && matchString(item.severity, severityFilter)
        && matchString(item.stage ?? "", stageFilter)
        && matchString(item.scanner ?? "", scannerFilter)
        && matchString(item.flowId, flowIdFilter)
        && matchString(item.dependsOnFlowId ?? "", dependsOnFlowIdFilter);
    });

    const sorted = sortItems(filtered, input, (item, sortBy) => {
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

    return paginate(sorted, { limit, offset });
  }

  async getRuntimeActivityById(input: DockerRuntimeActivityDetailQueryInput): Promise<DockerRuntimeActivityEntity | null> {
    const row = await this.runOnDatabase(this.activities.findById(input.id));

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

    const alive = await this.runOnDatabase(this.lifecycle.ensureAlive(normalizedIdentifier));
    if (alive.event !== null) {
      await this.emitImageLifecycleRuntimeEvent("create", alive.event, {
        imageIdentifierNormalized: normalizedIdentifier,
      });
    }

    return {
      imageIdentifierNormalized: normalizedIdentifier,
      imageGeneration: alive.imageGeneration,
      revived: alive.revived,
    };
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
    try {
      return await runPromiseUnwrapped(
        this.images.inspectResolved(imageId).pipe(Effect.provideService(DockerEngine, this.dockerEngine)),
      );
    } catch (error: unknown) {
      if (error instanceof ImageNotFound) {
        throw new NotFoundException(`Image '${imageId}' not found`);
      }
      throw error;
    }
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

    const persisted = await this.runOnDatabase(this.scans.findLatest(normalizedCandidates));
    return persisted === null ? null : toPersistedScan(persisted);
  }

  private async persistImageSecurityScan(inspectId: string, scanResult: RawImageSecurityScan): Promise<void> {
    const lifecycle = await this.ensureImageLifecycleAlive(inspectId);
    if (lifecycle.imageIdentifierNormalized.length === 0) {
      return;
    }

    await this.runOnDatabase(
      this.scans.save({
        imageId: inspectId,
        imageIdentifierNormalized: lifecycle.imageIdentifierNormalized,
        imageGeneration: lifecycle.imageGeneration,
        scanHash: computeScanHash(lifecycle.imageIdentifierNormalized, lifecycle.imageGeneration, scanResult),
        scan: scanResult,
      }),
    );
  }

  /** Run a lifecycle query against the shared runtime database the Nest module owns. */
  private runOnDatabase<A, E>(effect: Effect.Effect<A, E, RuntimeDb | RuntimeDatabasePort>): Promise<A> {
    return runPromiseUnwrapped(
      effect.pipe(
        Effect.provideService(RuntimeDb, RuntimeDb.live),
        Effect.provideService(RuntimeDatabasePort, this.globalDatabaseService),
      ),
    );
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async listImages(input: DockerImageListInput) {
    const mapped = await runPromiseUnwrapped(this.images.list.pipe(Effect.provideService(DockerEngine, this.dockerEngine)));

    const filtered = mapped.filter((item) => {
      const registryMatch = matchString(item.registry, getFilterEntry(input, "registry"));
      const repositoryMatch = matchString(item.repository, getFilterEntry(input, "repository"));
      const tagMatch = matchString(item.tag ?? "", getFilterEntry(input, "tag"));
      return registryMatch && repositoryMatch && tagMatch;
    });

    const sorted = sortItems(filtered, input, (item, sortBy) => {
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

    return paginate(sorted, input);
  }

  async listNetworks(input: DockerNetworkListInput) {
    const mapped = await runPromiseUnwrapped(this.networks.list.pipe(Effect.provideService(DockerEngine, this.dockerEngine)));

    const filtered = mapped.filter((item) => {
      const nameMatch = matchString(item.name, getFilterEntry(input, "name"));
      const driverMatch = matchEq(item.driver, getFilterEntry(input, "driver"));
      const scopeMatch = matchEq(item.scope, getFilterEntry(input, "scope"));
      return nameMatch && driverMatch && scopeMatch;
    });

    const sorted = sortItems(filtered, input, (item, sortBy) => {
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

    return paginate(sorted, input);
  }

  async listVolumes(input: DockerVolumeListInput) {
    const mapped = await runPromiseUnwrapped(this.volumes.list.pipe(Effect.provideService(DockerEngine, this.dockerEngine)));

    const filtered = mapped.filter((item) => {
      const nameMatch = matchString(item.name, getFilterEntry(input, "name"));
      const driverMatch = matchEq(item.driver, getFilterEntry(input, "driver"));
      return nameMatch && driverMatch;
    });

    const sorted = sortItems(filtered, input, (item, sortBy) => {
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

    return paginate(sorted, input);
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
      const nameMatch = matchString(item.name, getFilterEntry(input, "name"));
      const statusMatch = matchEq(item.status, getFilterEntry(input, "status"));
      const primaryMatch = matchEq(item.isPrimary, getFilterEntry(input, "isPrimary"));
      return nameMatch && statusMatch && primaryMatch;
    });

    const sorted = sortItems(filtered, input, (item, sortBy) => {
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

    return paginate(sorted, input);
  }

  async listStacks(input: DockerStackListInput) {
    const rawContainers = await this.listRawContainers();

    const mapped = groupContainersIntoStacks(
      rawContainers.map((raw) => ({ stackName: stackNameOf(raw.Labels), container: this.toDockerContainer(raw) })),
      new Date().toISOString(),
    );

    const filtered = mapped.filter((item) => {
      const nameMatch = matchString(item.name, getFilterEntry(input, "name"));
      const statusMatch = matchEq(item.status, getFilterEntry(input, "status"));
      const projectMatch = matchEq(item.projectId, getFilterEntry(input, "projectId"));
      return nameMatch && statusMatch && projectMatch;
    });

    const sorted = sortItems(filtered, input, (item, sortBy) => {
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

    return paginate(sorted, input);
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
