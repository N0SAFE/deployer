import { BasePooledEventService } from "@repo/nest-events";
import type { CoreEventStreamPoolService } from "@repo/nest-events";
import type { EventContracts, EventInput, EventOutput } from "@repo/nest-events";
import { MeshTopicContractNotFoundError } from "../domain/mesh-topic-errors";

/**
 * Runtime d'événements pour un namespace mesh-topic.
 *
 * Étend BasePooledEventService en préfixant le nom d'événement
 * par namespace (mesh-wide tenant — pas d'isolation par organization).
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
        _input: Record<string, unknown>,
    ): string {
        // The organization concept was removed — the mesh is the single tenant,
        // so events are not org-scoped: namespace:event only.
        return `${this.namespace}:${eventName}`;
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