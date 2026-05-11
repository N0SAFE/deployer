import { Injectable } from "@nestjs/common";
import type { DockerNetworkListInput } from "@repo/api-contracts/modules/docker/networks/list";
import { AppLogger } from "@repo/logger";
import { DockerNetworksDomainService } from "../runtime/docker-networks-domain.service";

@Injectable()
export class DockerNetworksOrchestratorService {
  private readonly apiLogger = new AppLogger("api").scope(DockerNetworksOrchestratorService.name);
  private readonly scopedLogger = this.apiLogger.log;

  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerNetworksOrchestratorService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-networks-orchestrator",
  });

  constructor(private readonly dockerNetworksDomainService: DockerNetworksDomainService) {}

  listNetworks(input: DockerNetworkListInput) {
    this.debug("DockerNetworksOrchestratorService.listNetworks", {
      limit: input.limit,
      offset: input.offset,
      hasFilter: Boolean(input.filter),
    });

    return this.dockerNetworksDomainService.listNetworks(input);
  }

  private debug(source: string, context?: Record<string, unknown>): void {
    this.scopedLogger.info(`[docker-networks-orchestrator] ${source}`, context ?? {});
    this.debugLogger.debug(source, context);
  }
}
