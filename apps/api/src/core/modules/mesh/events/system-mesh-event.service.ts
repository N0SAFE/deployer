import { Injectable } from "@nestjs/common";
import { BaseEventService } from "@/core/modules/events/base-event.service";
import { observableToAsyncIterable } from "@/core/utils/observable.utils";
import type { MeshRuntimeEvent, MeshTopologyEvent } from "@repo/api-contracts/common/mesh";
import {
    systemMeshEventContracts,
    type SystemMeshEventContracts,
} from "./system-mesh-event.contracts";

@Injectable()
export class SystemMeshEventService extends BaseEventService<SystemMeshEventContracts> {
    constructor() {
        super("mesh", systemMeshEventContracts);
    }

    emitRuntime(clusterId: string, event: MeshRuntimeEvent): void {
        this.emit("runtime", { clusterId }, event);
    }

    emitTopology(clusterId: string, event: MeshTopologyEvent): void {
        this.emit("topology", { clusterId }, event);
    }

    observeRuntime(input: { clusterId: string; replay: boolean; replayLimit: number }) {
        return this.subscribe$(
            "runtime",
            { clusterId: input.clusterId },
            {
                replayLimit: input.replayLimit,
                includePersisted: input.replay,
            },
        );
    }

    observeTopology(input: { clusterId: string; replay: boolean; replayLimit: number }) {
        return this.subscribe$(
            "topology",
            { clusterId: input.clusterId },
            {
                replayLimit: input.replayLimit,
                includePersisted: input.replay,
            },
        );
    }

    /**
     * Observe runtime events strictly after a given sequence cursor.
     * Used for reconnect scenarios: subscriber passes back the last sequence they received.
     */
    observeRuntimeSince(input: { clusterId: string; afterSequence: number }) {
        return this.subscribe$(
            "runtime",
            { clusterId: input.clusterId },
            { afterSequence: input.afterSequence, includePersisted: false },
        );
    }

    /**
     * Observe topology events strictly after a given sequence cursor.
     */
    observeTopologySince(input: { clusterId: string; afterSequence: number }) {
        return this.subscribe$(
            "topology",
            { clusterId: input.clusterId },
            { afterSequence: input.afterSequence, includePersisted: false },
        );
    }

    runtimeLastSequence(clusterId: string): number {
        return this.getLastSequence("runtime", { clusterId });
    }

    streamRuntime(input: { clusterId: string; replay: boolean; replayLimit: number }) {
        return observableToAsyncIterable(this.observeRuntime(input));
    }

    streamTopology(input: { clusterId: string; replay: boolean; replayLimit: number }) {
        return observableToAsyncIterable(this.observeTopology(input));
    }
}