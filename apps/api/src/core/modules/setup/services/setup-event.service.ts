import * as z from "zod/v4";
import { Injectable, Optional } from "@nestjs/common";
import { Observable } from "rxjs";
import { BasePooledEventService } from "@repo/nest-events";
import { contractBuilder } from "@repo/nest-events";
import { CoreEventStreamPoolService } from "@repo/nest-events";
import { setupStreamEventSchema } from "@repo/contracts-entities";
import type { SetupStreamEvent } from "@repo/contracts-entities";

export const setupEventContracts = {
    progress: contractBuilder()
        .input(z.object({}))
        .output(setupStreamEventSchema)
        .build(),
} as const;

export type SetupEventContracts = typeof setupEventContracts;

@Injectable()
export class SetupEventService extends BasePooledEventService<SetupEventContracts, "setup"> {
    constructor(
        @Optional()
        streamPool?: CoreEventStreamPoolService,
    ) {
        super("setup", setupEventContracts, streamPool);
    }

    /**
     * Observe the initialization progress stream, WITH replay of recent events.
     *
     * ── WHY REPLAY IS REQUIRED, NOT A CONVENIENCE ───────────────────────────────
     * This stream is re-subscribed for reasons the CLIENT does not control, and
     * the reconnect is not a fresh start: the ingress is replaced during the
     * handover, which tears the connection down, and the client reconnects to
     * the SAME URL once the new ingress answers.
     *
     * With no replay that reconnect yielded NOTHING — every event had already
     * been sent before the swap, so the operator's timeline sat frozen with no
     * further updates and no indication why. Observed as "the stream reconnects
     * but no event comes from this endpoint".
     *
     * Replaying the buffer lets the API re-sync whatever the client missed. It is
     * BOUNDED (`durableReplayLimit`) rather than unbounded, because the only
     * consumer is a reconnect that is seconds behind, and the setup run is a
     * finite pipeline — the steps are snapshots, so the tail carries the current
     * state of every step anyway.
     *
     * `includePersisted: false` is kept: these events are ephemeral progress for
     * one run, and reading them from durable storage on every subscribe would
     * make a reconnect depend on the database being up — exactly the window in
     * which it might not be.
     */
    observeProgress$(): Observable<SetupStreamEvent> {
        return this.subscribe$('progress', {}, {
            replayLimit: this.durableReplayLimit,
            includePersisted: false,
        })
    }
}
