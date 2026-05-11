import { Injectable } from "@nestjs/common";
import type { DockerRegistryListInput } from "@repo/api-contracts/modules/docker/registries/list";
import { AppLogger } from "@repo/logger";
import { DockerRegistriesDomainService } from "../runtime/docker-registries-domain.service";

@Injectable()
export class DockerRegistriesOrchestratorService {
  private readonly apiLogger = new AppLogger("api").scope(DockerRegistriesOrchestratorService.name);
  private readonly scopedLogger = this.apiLogger.log;

  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerRegistriesOrchestratorService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-registries-orchestrator",
  });

  constructor(private readonly dockerRegistriesDomainService: DockerRegistriesDomainService) {}

  listRegistries(input: DockerRegistryListInput) {
    this.debug("DockerRegistriesOrchestratorService.listRegistries", {
      limit: input.limit,
      offset: input.offset,
      hasFilter: Boolean(input.filter),
    });

    return this.dockerRegistriesDomainService.listRegistries(input);
  }

  private debug(source: string, context?: Record<string, unknown>): void {
    this.scopedLogger.info(`[docker-registries-orchestrator] ${source}`, context ?? {});
    this.debugLogger.debug(source, context);
  }
}
