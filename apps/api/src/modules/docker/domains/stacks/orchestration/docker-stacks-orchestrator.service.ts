import { Injectable } from "@nestjs/common";
import type { DockerStackListInput } from "@repo/api-contracts/modules/docker/stacks/list";
import { AppLogger } from "@repo/logger";
import { DockerStacksDomainService } from "../runtime/docker-stacks-domain.service";

@Injectable()
export class DockerStacksOrchestratorService {
  private readonly apiLogger = new AppLogger("api").scope(DockerStacksOrchestratorService.name);
  private readonly scopedLogger = this.apiLogger.log;

  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerStacksOrchestratorService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-stacks-orchestrator",
  });

  constructor(private readonly dockerStacksDomainService: DockerStacksDomainService) {}

  listStacks(input: DockerStackListInput = {} as DockerStackListInput) {
    this.debug("DockerStacksOrchestratorService.listStacks", {
      limit: input.limit,
      offset: input.offset,
      hasFilter: Boolean(input.filter),
    });

    return this.dockerStacksDomainService.listStacks(input);
  }

  private debug(source: string, context?: Record<string, unknown>): void {
    this.scopedLogger.info(`[docker-stacks-orchestrator] ${source}`, context ?? {});
    this.debugLogger.debug(source, context);
  }
}
