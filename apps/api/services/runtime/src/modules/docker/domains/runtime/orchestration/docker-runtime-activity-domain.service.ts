import { filter, from, map, mergeMap } from "rxjs";

import { dockerRuntimeEventSourceSchema, type DockerRuntimeActivityEntity } from "@deployer/contracts-entities";
import type { DockerRuntimeActivityStreamInput } from "@deployer/runtime-contracts/modules/docker/runtime/activity-stream";
import type { DockerRuntimeEventsStreamQueryInput } from "@deployer/runtime-contracts/modules/docker/runtime/shared";

import { projectRuntimeEvent } from "../../../common/events/runtime-activity-projection";
import type { SwarmActivityEnricherService } from "../../../common/events/swarm-activity-enricher.service";
import type { DockerRuntimeStreamOrchestratorService } from "../../../common/runtime/docker-runtime-stream-orchestrator.service";

/** Built by a factory in `DockerRuntimeModule`. */
export class DockerRuntimeActivityDomainService {
  constructor(
    private readonly dockerRuntimeStreamOrchestratorService: DockerRuntimeStreamOrchestratorService,
    private readonly swarmActivityEnricherService: SwarmActivityEnricherService,
  ) {}

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
              projectRuntimeEvent(
                enrichment.event,
                enrichment,
              ),
            ),
          ),
        ),
      );
  }

}
