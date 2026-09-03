import { Injectable } from "@nestjs/common";
import type {
  DockerImageListInput,
} from "@repo/api-contracts/modules/docker/images/list";
import type { DockerImageInspectQueryInput } from "@repo/api-contracts/modules/docker/images/inspect";
import type { DockerImageInspectStreamQueryInput } from "@repo/api-contracts/modules/docker/images/stream-inspect";
import type {
  DockerImageSecurityScanStreamQueryInput,
} from "@repo/api-contracts/modules/docker/security/scanning/images/stream";
import { AppLogger } from "@repo/logger";
import { DockerImagesApplicationService } from "../application/docker-images-application.service";
import type { EnsureImageSecurityScanOptions } from "../security/docker-image-security-scan.service";

@Injectable()
export class DockerImagesOrchestratorService {
  private readonly apiLogger = new AppLogger("api").scope(DockerImagesOrchestratorService.name);
  private readonly scopedLogger = this.apiLogger.log;

  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerImagesOrchestratorService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-images-orchestrator",
  });

  constructor(private readonly dockerImagesApplicationService: DockerImagesApplicationService) {}

  async inspectImage(input: DockerImageInspectQueryInput) {
    this.debug("DockerImagesOrchestratorService.inspectImage", {
      imageId: input.imageId,
    });

    return this.dockerImagesApplicationService.inspectImage(input);
  }

  streamImageInspect(input: DockerImageInspectStreamQueryInput) {
    this.debug("DockerImagesOrchestratorService.streamImageInspect", {
      imageId: input.imageId,
      refreshIntervalMs: input.refreshIntervalMs,
    });

    return this.dockerImagesApplicationService.streamImageInspect(input);
  }

  streamImageSecurityScan(input: DockerImageSecurityScanStreamQueryInput) {
    const imageId = input.imageId.trim();

    this.debug("DockerImagesOrchestratorService.streamImageSecurityScan", {
      imageId,
      refreshIntervalMs: input.refreshIntervalMs,
      forceScan: input.forceScan ?? false,
      maxCacheAgeMs: input.maxCacheAgeMs,
    });

    return this.dockerImagesApplicationService.streamImageSecurityScan(input);
  }

  async ensureImageSecurityScan(
    input: DockerImageSecurityScanStreamQueryInput,
    options: EnsureImageSecurityScanOptions = {},
  ) {
    return this.dockerImagesApplicationService.ensureImageSecurityScan(input, options);
  }

  listImages(input: DockerImageListInput = {} as DockerImageListInput) {
    this.debug("DockerImagesOrchestratorService.listImages", {
      limit: input.limit,
      offset: input.offset,
      hasFilter: Boolean(input.filter),
    });

    return this.dockerImagesApplicationService.listImages(input);
  }

  private debug(source: string, context?: Record<string, unknown>): void {
    this.scopedLogger.info(`[docker-images-orchestrator] ${source}`, context ?? {});
    this.debugLogger.debug(source, context);
  }
}
