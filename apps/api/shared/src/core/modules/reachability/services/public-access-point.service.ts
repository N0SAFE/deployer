/**
 * Public Access Point Service — first-class core service.
 *
 * The single entry point for every feature that needs to know where this node
 * is publicly reachable and whether it is actually up. It uses the CORE EVENT
 * SYSTEM (PublicAccessPointEventService) as the global relay — the state is a
 * Zod discriminated union (`kind`: ip | hostname | tunnel | null).
 *
 *   - `getAccessPoint()`  — request ⇒ live re-check ⇒ emit onto the global
 *     relay ⇒ return the fresh state. This is the "when the service is
 *     requested" push.
 *   - `watchAccessPoint()` — subscribe to the global event relay to receive
 *     the current state everywhere, whenever it changes.
 *
 * The access point can be a public IP, a hostname, or a DNS-provider-backed
 * tunnel. All derived from the node network config — never env vars.
 */
import { Injectable } from "@nestjs/common";
import { Observable } from "rxjs";
import { ReachabilityService } from "./reachability.service";
import { PublicAccessPointEventService } from "../events/public-access-point-event.service";
import type { PublicAccessPointEvent } from "../events/public-access-point-event.contracts";

@Injectable()
export class PublicAccessPointService {
    constructor(
        private readonly reachabilityService: ReachabilityService,
        private readonly accessPointEvents: PublicAccessPointEventService,
    ) {}

    /**
     * Request the public access point: re-checks availability (probes the
     * node's own endpoints), emits the result onto the global event relay,
     * and returns it. Every `watchAccessPoint()` subscriber gets the update.
     */
    async getAccessPoint(): Promise<PublicAccessPointEvent> {
        const state = await this.reachabilityService.resolveAccessPointState();
        this.accessPointEvents.emitAccessPointUpdated(state);
        return state;
    }

    /**
     * Observe the global access-point event relay. Emits every state push.
     */
    watchAccessPoint(): Observable<PublicAccessPointEvent> {
        return this.accessPointEvents.watchAccessPoint$();
    }
}

