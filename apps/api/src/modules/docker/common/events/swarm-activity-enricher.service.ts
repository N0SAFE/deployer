import { Injectable, Logger } from "@nestjs/common";
import { from, type Observable } from "rxjs";
import { filter, map, mergeMap } from "rxjs/operators";
import type { DockerRuntimeEvent } from "@repo/contracts-entities";
import { DockerService } from "@repo/nest-docker/services/docker.service";

/** A synthesized activity: the docker event enriched with real swarm state. */
export interface SwarmActivityEnrichment {
  /** The event that triggered the read. */
  event: DockerRuntimeEvent;
  /**
   * Live task state at the moment of the read — the ONLY place a swarm failure
   * reason exists. Empty when the engine returned no tasks (non-swarm node, or
   * the resource was already reaped).
   */
  tasks: SwarmTaskState[];
  /** Live service state, when the event named a service. */
  service: SwarmServiceState | null;
}

export interface SwarmTaskState {
  taskId: string;
  serviceId: string;
  serviceName: string;
  nodeId: string | null;
  slot: number | null;
  state: string;
  desiredState: string;
  /** Operator-facing failure reason, e.g. "no suitable node (host-mode port already in use on 1 node)". */
  error: string | null;
}

export interface SwarmServiceState {
  serviceId: string;
  serviceName: string;
  image: string;
  mode: string;
  desiredTasks: number;
  runningTasks: number;
  /** Service-level update failure, when the orchestrator recorded one. */
  updateMessage: string | null;
}

/** Swarm sources whose events are worth enriching with live state. */
const SWARM_SOURCES = new Set(["service", "node", "task"]);

/**
 * SwarmActivityEnricher — turns a bare swarm event into one that carries STATE.
 *
 * ── WHY THIS EXISTS (measured, not assumed) ──────────────────────────────────
 * Docker's swarm events are SIGNALS, not state. A real `service` event on
 * engine 29.8.1 is exactly this and nothing more:
 *
 *   {"Type":"service","Action":"create",
 *    "Actor":{"ID":"pukg…","Attributes":{"name":"rawloop"}},
 *    "scope":"swarm","time":1790971434}
 *
 * No state. No replicas. No error. So a feed built from events alone can only
 * ever render `service.create` — which is precisely the information an operator
 * does NOT need when something is broken.
 *
 * Worse, the failure text they DO need is not in the event stream at all. With a
 * crash-looping service (four `Failed` tasks) and a host-port-conflict service
 * (`Pending`), the raw `/events` socket emitted **zero** task events — verified
 * three ways: `docker events`, `docker events --filter type=task`, and a raw
 * curl on the daemon socket. Yet `docker service ps` reported:
 *
 *   Failed  3 seconds ago | "task: non-zero exit (1)"
 *   Pending 3 seconds ago | "no suitable node (host-mode port already in use on 1 node)"
 *
 * That reason is the whole point of the feature — it is what the port-80 ingress
 * conflict and the `network sandbox join failed: … vxlan interface: file exists`
 * incidents both needed, and neither was visible from the event stream.
 *
 * ── SO: EVENTS TRIGGER, PROBES INFORM ───────────────────────────────────────
 * Each swarm event is used as a TRIGGER to read live state once, and the two are
 * merged. This is the same shape `ClusterSwarmEventsService` already uses (docker
 * events → `swarmFleetService.listTasks()`), kept consistent rather than inventing
 * a second mechanism.
 *
 * The read is deliberately scoped: a service/task event reads only that service's
 * tasks, so a burst of events on a busy node cannot fan out into a full-fleet
 * read per event.
 */
@Injectable()
export class SwarmActivityEnricherService {
  private readonly logger = new Logger(SwarmActivityEnricherService.name);

  constructor(private readonly dockerService: DockerService) {}

  /** True when this event is a swarm resource worth enriching. */
  isSwarmEvent(event: DockerRuntimeEvent): boolean {
    return SWARM_SOURCES.has(event.source);
  }

  /**
   * Enrich ONE event with live swarm state.
   *
   * Public because the activity stream applies it per-event inside its RxJS
   * pipe (`mergeMap`), where a stream-level helper would force an extra
   * flatten. Non-swarm events return immediately WITHOUT touching the engine,
   * so the container/image/volume paths pay nothing for this.
   */
  async enrichEvent(event: DockerRuntimeEvent): Promise<SwarmActivityEnrichment> {
    return await this.enrichOne(event);
  }

  /**
   * Enrich a stream of runtime events with live swarm state.
   *
   * Non-swarm events pass through with empty enrichment, so a caller can pipe
   * ANY docker stream through this and get one uniform shape.
   */
  enrich(events$: Observable<DockerRuntimeEvent>): Observable<SwarmActivityEnrichment> {
    return events$.pipe(
      mergeMap((event) =>
        from(this.enrichOne(event)).pipe(map((enrichment) => enrichment)),
      ),
    );
  }

  /** Enrich only swarm events; everything else is dropped. */
  enrichSwarmOnly(events$: Observable<DockerRuntimeEvent>): Observable<SwarmActivityEnrichment> {
    return this.enrich(events$.pipe(filter((event) => this.isSwarmEvent(event))));
  }

  private async enrichOne(event: DockerRuntimeEvent): Promise<SwarmActivityEnrichment> {
    if (!this.isSwarmEvent(event)) {
      return { event, tasks: [], service: null };
    }

    // The service to read. A `task` event names its service through the payload;
    // a `service` event IS the service.
    const serviceId = this.resolveServiceId(event);

    try {
      const [tasks, service] = await Promise.all([
        this.readTasks(serviceId),
        serviceId === null ? Promise.resolve(null) : this.readService(serviceId),
      ]);
      return { event, tasks, service };
    } catch (error: unknown) {
      // Enrichment is best-effort by design: a swarm read can legitimately fail
      // on a non-swarm node (`This node is not a swarm manager`), and that must
      // NOT swallow the event — the event is still true and still worth showing.
      this.logger.warn(
        `Swarm enrichment failed for ${event.source}.${event.action}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { event, tasks: [], service: null };
    }
  }

  /** The swarm service id an event refers to, or null when it names none. */
  private resolveServiceId(event: DockerRuntimeEvent): string | null {
    if (event.source === "service") return event.actorId;

    if (event.source === "task") return event.payload.serviceId;

    // Task events can also arrive as an unknown source when the engine labels
    // them unexpectedly; the service id is still in the actor attributes.
    const fromAttributes = event.actorAttributes["com.docker.swarm.service.id"];
    return typeof fromAttributes === "string" && fromAttributes.length > 0 ? fromAttributes : null;
  }

  private async readTasks(serviceId: string | null): Promise<SwarmTaskState[]> {
    const tasks = await this.dockerService.listAllSwarmTasks(
      serviceId === null ? undefined : { serviceId },
    );
    const services = await this.dockerService.listSwarmServices();
    const nameById = new Map(services.map((service) => [service.ID, service.Spec.Name]));

    return tasks.map((task) => ({
      taskId: task.ID,
      serviceId: task.ServiceID,
      serviceName: nameById.get(task.ServiceID) ?? "",
      nodeId: task.NodeID ?? null,
      slot: task.Slot ?? null,
      state: task.Status?.State ?? "",
      desiredState: task.DesiredState ?? "",
      // THE reason this service exists: the failure text lives on the task and
      // nowhere in the event stream.
      error: task.Status?.Err ?? null,
    }));
  }

  private async readService(serviceId: string): Promise<SwarmServiceState | null> {
    const services = await this.dockerService.listSwarmServices();
    const service = services.find((entry) => entry.ID === serviceId);
    if (service === undefined) return null;

    const tasks = await this.dockerService.listAllSwarmTasks({ serviceId });
    const runningTasks = tasks.filter((task) => task.Status?.State === "running").length;
    const isGlobal = service.Spec.Mode?.Global !== undefined;

    return {
      serviceId,
      serviceName: service.Spec.Name,
      image: service.Spec.TaskTemplate?.ContainerSpec?.Image ?? "",
      mode: isGlobal ? "global" : "replicated",
      desiredTasks: isGlobal ? tasks.length : (service.Spec.Mode?.Replicated?.Replicas ?? 0),
      runningTasks,
      updateMessage: service.UpdateStatus?.Message ?? null,
    };
  }
}
