import { filter, type Observable } from "rxjs";
import type { DockerRuntimeEvent } from "@deployer/contracts-entities";

/**
 * The runtime events a node relays to its peers: everything the engine reports except swarm `task` events.
 * Task events were never part of the relayed per-source streams (container, image, network, volume, service and
 * the system sources), so they are not sent to peers; the relay keeps that behaviour.
 */
export function relayableRuntimeEvents(source$: Observable<DockerRuntimeEvent>): Observable<DockerRuntimeEvent> {
  return source$.pipe(filter((event) => event.source !== "task"));
}
