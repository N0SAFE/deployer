import { BasePooledEventService } from "@/core/modules/events/services/base-pooled-event.service";
import type { CoreEventStreamPoolService } from "@/core/modules/events/services/core-event-stream-pool.service";
import type { EventContracts } from "@/core/modules/events/event-contract.builder";
import { MeshTopicContractNotFoundError } from "../domain/mesh-topic-errors";

/**
 * Runtime d'événements pour un namespace mesh-topic.
 *
 * Étend BasePooledEventService en préfixant le nom d'événement
 * par l'organizationId pour l'isolation multi-tenant.
 */
export class MeshTopicNamespaceRuntime<
    TContracts extends EventContracts,
> extends BasePooledEventService<TContracts> {
    constructor(
        namespace: string,
        contracts: TContracts,
        streamPool: CoreEventStreamPoolService,
    ) {
        super(`mesh-topic:${namespace}`, contracts, streamPool);
    }

    protected override buildFullEventName(
        eventName: string,
        input: Record<string, unknown>,
    ): string {
        const organizationId =
            typeof input.organizationId === "string" && input.organizationId.length > 0
                ? input.organizationId
                : "__global__";

        return `${this.namespace}:${eventName}:${organizationId}`;
    }

    parseInput<K extends keyof TContracts>(topic: K, input: unknown): unknown {
        const contract = this.contracts[topic];
        if (!contract) {
            throw new MeshTopicContractNotFoundError(
                String(topic),
                this.namespace,
            );
        }
        return contract.input.parse(input);
    }

    parseOutput<K extends keyof TContracts>(topic: K, output: unknown): unknown {
        const contract = this.contracts[topic];
        if (!contract) {
            throw new MeshTopicContractNotFoundError(
                String(topic),
                this.namespace,
            );
        }
        return contract.output.parse(output);
    }
}