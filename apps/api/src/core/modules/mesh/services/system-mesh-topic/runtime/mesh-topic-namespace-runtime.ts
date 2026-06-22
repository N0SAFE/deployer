import { BasePooledEventService } from "@/core/modules/events/services/base-pooled-event.service";
import type { CoreEventStreamPoolService } from "@/core/modules/events/services/core-event-stream-pool.service";
import type { EventContracts, EventInput, EventOutput } from "@/core/modules/events/event-contract.builder";
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

    parseInput<K extends keyof TContracts>(topic: K, input: EventInput<TContracts[K]>): EventOutput<TContracts[K]> {
        // topic may be full name, get local name for contract lookup
        const localTopic = String(topic).startsWith(`${this.namespace}:`)
            ? String(topic).slice(this.namespace.length + 1)
            : String(topic);
        const contract = this.contracts[localTopic as keyof TContracts] as TContracts[K] | undefined
        if (!contract) {
            throw new MeshTopicContractNotFoundError(
                String(topic),
                this.namespace,
            );
        }
        return contract.input.parse(input) as EventOutput<TContracts[K]>;
    }

    parseOutput<K extends keyof TContracts>(topic: K, output: unknown): unknown {
        // topic may be full name, get local name for contract lookup
        const localTopic = String(topic).startsWith(`${this.namespace}:`)
            ? String(topic).slice(this.namespace.length + 1)
            : String(topic);
        const contract = this.contracts[localTopic as keyof TContracts];
        if (!contract) {
            throw new MeshTopicContractNotFoundError(
                String(topic),
                this.namespace,
            );
        }
        return contract.output.parse(output);
    }
}