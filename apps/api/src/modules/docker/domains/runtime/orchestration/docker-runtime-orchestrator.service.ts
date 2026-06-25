import { Injectable } from "@nestjs/common";
import type {
  DockerContainerInspectStreamQueryInput,
} from "@repo/api-contracts/modules/docker/containers/shared";
import type {
  DockerRuntimeActivityDetailQueryInput,
  DockerRuntimeActivityListInput,
} from "@repo/api-contracts/modules/docker/runtime/activity";
import type { DockerImageInspectStreamQueryInput } from "@repo/api-contracts/modules/docker/images/stream-inspect";
import type { DockerRuntimeActivityStreamInput } from "@repo/api-contracts/modules/docker/runtime/activity-stream";
import type { DockerRuntimeEventsStreamQueryInput } from "@repo/api-contracts/modules/docker/runtime/shared";
import { AppLogger } from "@repo/logger";
import { DockerRuntimeActivityDomainService } from "./docker-runtime-activity-domain.service";
import { DockerRuntimeStreamOrchestratorService } from "../../../common/runtime/docker-runtime-stream-orchestrator.service";

@Injectable()
export class DockerRuntimeOrchestratorService {
  private readonly apiLogger = new AppLogger("api").scope(DockerRuntimeOrchestratorService.name);
  private readonly scopedLogger = this.apiLogger.log;

  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerRuntimeOrchestratorService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-runtime-orchestrator",
  });

  constructor(
    private readonly dockerRuntimeActivityDomainService: DockerRuntimeActivityDomainService,
    private readonly dockerRuntimeStreamOrchestratorService: DockerRuntimeStreamOrchestratorService,
  ) {}

  getRuntimeSnapshot() {
    this.debug("DockerRuntimeOrchestratorService.getRuntimeSnapshot");
    return this.dockerRuntimeActivityDomainService.getRuntimeSnapshot();
  }

  stream(input: DockerRuntimeEventsStreamQueryInput) {
    this.debug("DockerRuntimeOrchestratorService.stream", {
      since: input.since,
      until: input.until,
      hasFilter: Boolean(input.filter),
    });

    return this.dockerRuntimeActivityDomainService.stream(input);
  }

  listRuntimeActivities(input: DockerRuntimeActivityListInput) {
    this.debug("DockerRuntimeOrchestratorService.listRuntimeActivities", {
      limit: input.limit,
      offset: input.offset,
      hasFilter: Boolean(input.filter),
    });

    return this.dockerRuntimeActivityDomainService.listRuntimeActivities(input);
  }

  getRuntimeActivityById(input: DockerRuntimeActivityDetailQueryInput) {
    this.debug("DockerRuntimeOrchestratorService.getRuntimeActivityById", {
      id: input.id,
    });

    return this.dockerRuntimeActivityDomainService.getRuntimeActivityById(input);
  }

  streamRuntimeActivities(input: DockerRuntimeActivityStreamInput = {}) {
    this.debug("DockerRuntimeOrchestratorService.streamRuntimeActivities", {
      source: input?.source,
      action: input?.action,
    });

    return this.dockerRuntimeActivityDomainService.streamActivities(input);
  }

  streamContainerInspect(input: DockerContainerInspectStreamQueryInput) {
    return this.dockerRuntimeStreamOrchestratorService.streamContainerInspect(input);
  }

  streamImageInspect(input: DockerImageInspectStreamQueryInput) {
    return this.dockerRuntimeStreamOrchestratorService.streamImageInspect(input);
  }

  private debug(source: string, context?: Record<string, unknown>): void {
    this.scopedLogger.info(`[docker-runtime-orchestrator] ${source}`, context ?? {});
    this.debugLogger.debug(source, context);
  }
}
