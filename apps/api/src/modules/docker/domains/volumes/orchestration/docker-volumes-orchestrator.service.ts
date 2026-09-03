import { Injectable } from "@nestjs/common";
import type { DockerVolumeListInput } from "@repo/api-contracts/modules/docker/volumes/list";
import { AppLogger } from "@repo/logger";
import { DockerVolumesDomainService } from "../runtime/docker-volumes-domain.service";

@Injectable()
export class DockerVolumesOrchestratorService {
  private readonly apiLogger = new AppLogger("api").scope(DockerVolumesOrchestratorService.name);
  private readonly scopedLogger = this.apiLogger.log;

  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerVolumesOrchestratorService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-volumes-orchestrator",
  });

  constructor(private readonly dockerVolumesDomainService: DockerVolumesDomainService) {}

  listVolumes(input: DockerVolumeListInput = {} as DockerVolumeListInput) {
    this.debug("DockerVolumesOrchestratorService.listVolumes", {
      limit: input.limit,
      offset: input.offset,
      hasFilter: Boolean(input.filter),
    });

    return this.dockerVolumesDomainService.listVolumes(input);
  }

  private debug(source: string, context?: Record<string, unknown>): void {
    this.scopedLogger.info(`[docker-volumes-orchestrator] ${source}`, context ?? {});
    this.debugLogger.debug(source, context);
  }
}
