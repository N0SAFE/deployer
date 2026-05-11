import { Injectable } from "@nestjs/common";
import { Observable } from "rxjs";
import type {
  DockerImageListInput,
} from "@repo/api-contracts/modules/docker/images/list";
import type { DockerImageInspectQueryInput } from "@repo/api-contracts/modules/docker/images/inspect";
import type { DockerImageInspectStreamQueryInput } from "@repo/api-contracts/modules/docker/images/stream-inspect";
import type {
  DockerImageSecurityScanStreamQueryInput,
} from "@repo/api-contracts/modules/docker/security/scanning/images/stream";
import type {
  DockerImageInspectDetail,
  DockerImageSecurityScanEvent,
} from "@repo/contracts-entities";
import { DockerImageCatalogRepository } from "../../../repositories/images/catalog/docker-image-catalog.repository";
import { DockerRuntimeStreamOrchestratorService } from "../../../common/runtime/docker-runtime-stream-orchestrator.service";
import {
  DockerImageSecurityScanService,
  type EnsureImageSecurityScanOptions,
  type EnsureImageSecurityScanResult,
} from "../security/docker-image-security-scan.service";

@Injectable()
export class DockerImagesApplicationService {
  constructor(
    private readonly dockerImageCatalogRepository: DockerImageCatalogRepository,
    private readonly dockerRuntimeStreamOrchestratorService: DockerRuntimeStreamOrchestratorService,
    private readonly dockerImageSecurityScanService: DockerImageSecurityScanService,
  ) {}

  async inspectImage(input: DockerImageInspectQueryInput): Promise<DockerImageInspectDetail> {
    return this.dockerImageCatalogRepository.inspectImage(input.imageId.trim());
  }

  streamImageInspect(input: DockerImageInspectStreamQueryInput): Observable<DockerImageInspectDetail> {
    return this.dockerRuntimeStreamOrchestratorService.streamImageInspect(input);
  }

  streamImageSecurityScan(input: DockerImageSecurityScanStreamQueryInput): Observable<DockerImageSecurityScanEvent> {
    return this.dockerImageSecurityScanService.streamImageSecurityScan(input);
  }

  ensureImageSecurityScan(
    input: DockerImageSecurityScanStreamQueryInput,
    options: EnsureImageSecurityScanOptions = {},
  ): Promise<EnsureImageSecurityScanResult> {
    return this.dockerImageSecurityScanService.ensureImageSecurityScan(input, options);
  }

  async listImages(input: DockerImageListInput) {
    return this.dockerImageCatalogRepository.listImages(input);
  }
}