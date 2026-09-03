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
     * Observe the initialization progress stream live — no replay of past events.
     *
     * Unlike the inherited `subscribe$()` which replays buffered events AND
     * subscribes to the live Subject (causing double delivery to the first
     * subscriber), this method skips all buffered/persisted replay and only
     * delivers events emitted after subscription time.
     *
     * The caller MUST have already started the initialization via
     * `triggerInitialize()` or ensure the stream is opened before
     * initialization begins.
     */
    observeProgress$(): Observable<SetupStreamEvent> {
        return this.subscribe$('progress', {}, {
            replayLimit: 0,
            includePersisted: false,
        })
    }
}
