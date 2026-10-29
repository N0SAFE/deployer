import { Observable, Subject, defer, merge, share } from "rxjs";
import type { DockerRuntimeEvent } from "@deployer/contracts-entities";

import type { DockerRuntimeEventsSourceService } from "../events/docker-runtime-events-source.service";
import { relayableRuntimeEvents } from "../events/relayable-runtime-events";

/** What the relay needs of the mesh: the other nodes' event streams, and the id of this node once the agent has told it. */
export type RuntimeEventsPeers = {
  readonly streamRuntimeEvents: () => Observable<DockerRuntimeEvent>;
  readonly selfNodeId: () => string | undefined;
};

/**
 * Every docker runtime event of the mesh, as one stream.
 *
 * A node's own events are what its engine reports plus what the node adds by hand (`relayRuntimeEvent`, which a scan
 * uses to announce itself). Other nodes' events are not pushed here: this relay follows each node's own stream over the
 * mesh, so a node that is slow or gone costs only its own stream, and nothing is buffered for it. Each event carries the
 * id of the node it happened on.
 */
export class DockerRuntimeMeshRelayService {
  private readonly pushed = new Subject<DockerRuntimeEvent>();

  /** This node's events, followed by the engine once for however many observers there are. */
  private readonly local$ = defer(() => merge(relayableRuntimeEvents(this.source.stream({})), this.pushed)).pipe(
    share({ resetOnRefCountZero: true }),
  );

  constructor(
    private readonly source: Pick<DockerRuntimeEventsSourceService, "stream">,
    private readonly peers: RuntimeEventsPeers,
  ) {}

  /** This node's events only: what other nodes follow when they ask this one. */
  localEvents$(): Observable<DockerRuntimeEvent> {
    return new Observable<DockerRuntimeEvent>((subscriber) =>
      this.local$.subscribe({
        next: (event) => subscriber.next(this.withNodeId(event)),
        error: (error: unknown) => subscriber.error(error),
        complete: () => subscriber.complete(),
      }),
    );
  }

  /** Every node's events, this one's included. */
  observeRuntimeEvents(): Observable<DockerRuntimeEvent> {
    return merge(this.localEvents$(), this.peers.streamRuntimeEvents());
  }

  /** Adds an event this node wants the whole mesh to see. */
  relayRuntimeEvent(event: DockerRuntimeEvent): void {
    this.pushed.next(event);
  }

  private withNodeId(event: DockerRuntimeEvent): DockerRuntimeEvent {
    const nodeId = this.peers.selfNodeId();
    return nodeId === undefined
      ? event
      : { ...event, actorAttributes: { ...event.actorAttributes, meshNodeId: nodeId } };
  }
}
