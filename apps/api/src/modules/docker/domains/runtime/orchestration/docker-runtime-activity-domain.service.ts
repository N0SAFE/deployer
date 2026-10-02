import { Injectable } from "@nestjs/common";
import { filter, from, map, mergeMap } from "rxjs";
import type {
  DockerRuntimeActivityDetailQueryInput,
  DockerRuntimeActivityListInput,
} from "@repo/api-contracts/modules/docker/runtime/activity";
import type { DockerRuntimeActivityStreamInput } from "@repo/api-contracts/modules/docker/runtime/activity-stream";
import type { DockerRuntimeEventsStreamQueryInput } from "@repo/api-contracts/modules/docker/runtime/shared";
import { dockerRuntimeEventSourceSchema, type DockerRuntimeActivityEntity } from "@repo/contracts-entities";
import { DockerContainerResolutionService } from "../../containers/orchestration/docker-container-resolution.service";
import { DockerRuntimeStreamOrchestratorService } from "../../../common/runtime/docker-runtime-stream-orchestrator.service";
import { DockerRuntimeActivityProjectorService } from "../../../common/events/docker-runtime-activity-projector.service";
import { SwarmActivityEnricherService } from "../../../common/events/swarm-activity-enricher.service";
import { DockerRuntimeActivityRepository } from "../../../repositories/runtime/docker-runtime-activity.repository";

@Injectable()
export class DockerRuntimeActivityDomainService {
  constructor(
    private readonly dockerContainerResolutionService: DockerContainerResolutionService,
    private readonly dockerRuntimeStreamOrchestratorService: DockerRuntimeStreamOrchestratorService,
    private readonly dockerRuntimeActivityRepository: DockerRuntimeActivityRepository,
    private readonly dockerRuntimeActivityProjectorService: DockerRuntimeActivityProjectorService,
    private readonly swarmActivityEnricherService: SwarmActivityEnricherService,
  ) {}

  getRuntimeSnapshot() {
    return this.dockerContainerResolutionService.getRuntimeCatalogSnapshot();
  }

  stream(input: DockerRuntimeEventsStreamQueryInput) {
    return this.dockerRuntimeStreamOrchestratorService.stream(input);
  }

  streamActivities(input: DockerRuntimeActivityStreamInput = {}) {
    const sourceFilter = input?.source;
    const actionFilter = input?.action;
    // Push the source/action filter down to the runtime stream so we
    // don't pay the cost of every event on the wire. We still apply a
    // client-side filter as a safety net (the stream filter is
    // server-side best-effort, never load-bearing).
    const runtimeQuery: DockerRuntimeEventsStreamQueryInput = {};
    if (sourceFilter) {
      // The activity stream input is a loose string; the runtime stream
      // filter requires the closed enum — parse at the boundary.
      const parsedSource = dockerRuntimeEventSourceSchema.safeParse(sourceFilter);
      if (parsedSource.success) {
        runtimeQuery.filter = {
          source: { operator: "eq", value: parsedSource.data },
        };
      }
    }
    return this.dockerRuntimeStreamOrchestratorService
      .stream(runtimeQuery)
      .pipe(
        filter((event) => {
          if (sourceFilter && event.source !== sourceFilter) return false;
          if (actionFilter && event.action !== actionFilter) return false;
          return true;
        }),
        // ── ENRICH BEFORE PROJECTING ─────────────────────────────────────────
        // Swarm events carry no state, and the engine emits no task events at
        // all — so the failure reason only exists in live task state. Reading it
        // here is what lets the activity render "no suitable node (host-mode port
        // already in use)" instead of a bare `service.update`.
        //
        // Non-swarm events short-circuit inside the enricher (no engine read),
        // so the container/image/volume paths keep their existing cost.
        mergeMap((event) =>
          from(this.swarmActivityEnricherService.enrichEvent(event)).pipe(
            map((enrichment): DockerRuntimeActivityEntity =>
              this.dockerRuntimeActivityProjectorService.project(
                enrichment.event,
                enrichment,
              ),
            ),
          ),
        ),
      );
  }

  listRuntimeActivities(input: DockerRuntimeActivityListInput) {
    return this.dockerRuntimeActivityRepository.listRuntimeActivities(input);
  }

  getRuntimeActivityById(input: DockerRuntimeActivityDetailQueryInput) {
    return this.dockerRuntimeActivityRepository.getRuntimeActivityById(input);
  }
}
