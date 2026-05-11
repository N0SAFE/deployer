import { Injectable } from "@nestjs/common";
import { BasePooledEventService } from "@/core/modules/events/services/base-pooled-event.service";
import { CoreEventStreamPoolService } from "@/core/modules/events/services/core-event-stream-pool.service";
import { observableToAsyncIterable } from "@/core/utils/observable.utils";
import type { MeshRuntimeEvent, MeshTopologyEvent } from "@repo/contracts-entities";
import {
    systemMeshEventContracts,
    type SystemMeshEventContracts,
} from "./system-mesh-event.contracts";

@Injectable()
export class SystemMeshEventService extends BasePooledEventService<SystemMeshEventContracts> {
    constructor(streamPool: CoreEventStreamPoolService) {
        super("mesh", systemMeshEventContracts, streamPool);
    }

    emitRuntime(event: MeshRuntimeEvent): void {
        this.emit("runtime", {}, event);
    }

    emitTopology(event: MeshTopologyEvent): void {
        this.emit("topology", {}, event);
    }

    observeRuntime(input: { replay: boolean; replayLimit: number }) {
        return this.observePooledEvent$(
            "runtime",
            {},
            {
                replayLimit: input.replayLimit,
                includePersisted: input.replay,
                pool: !input.replay,
            },
        );
    }

    observeTopology(input: { replay: boolean; replayLimit: number }) {
        return this.observePooledEvent$(
            "topology",
            {},
            {
                replayLimit: input.replayLimit,
                includePersisted: input.replay,
                pool: !input.replay,
            },
        );
    }

    /**
     * Observe runtime events strictly after a given sequence cursor.
     * Used for reconnect scenarios: subscriber passes back the last sequence they received.
     */
    observeRuntimeSince(input: { afterSequence: number }) {
        return this.observePooledEvent$(
            "runtime",
            {},
            {
                afterSequence: input.afterSequence,
                includePersisted: false,
                pool: false,
            },
        );
    }

    /**
     * Observe topology events strictly after a given sequence cursor.
     */
    observeTopologySince(input: { afterSequence: number }) {
        return this.observePooledEvent$(
            "topology",
            {},
            {
                afterSequence: input.afterSequence,
                includePersisted: false,
                pool: false,
            },
        );
    }

    runtimeLastSequence(): number {
        return this.getLastSequence("runtime", {});
    }

    streamRuntime(input: { replay: boolean; replayLimit: number }) {
        return observableToAsyncIterable(this.observeRuntime(input));
    }

    streamTopology(input: { replay: boolean; replayLimit: number }) {
        return observableToAsyncIterable(this.observeTopology(input));
    }
}