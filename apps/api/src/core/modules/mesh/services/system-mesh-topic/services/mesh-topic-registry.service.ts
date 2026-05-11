import { Injectable } from "@nestjs/common";
import { CoreEventStreamPoolService } from "@/core/modules/events/services/core-event-stream-pool.service";
import type { EventContracts } from "@/core/modules/events/event-contract.builder";
import {
    MeshTopicNamespaceAlreadyRegisteredError,
    MeshTopicNamespaceNotFoundError,
} from "../domain/mesh-topic-errors";
import type {
    MeshTopicNamespaceDefinition,
    MeshTopicNamespaceHandle,
} from "../domain/mesh-topic-types";
import { MeshTopicNamespaceRuntime } from "../runtime/mesh-topic-namespace-runtime";
import type { MeshTopicPublisherService } from "./mesh-topic-publisher.service";
import type { MeshTopicQueryBusService } from "./mesh-topic-query-bus.service";
import type { MeshTopicResourceIndexService } from "./mesh-topic-resource-index.service";

/**
 * Registre des namespaces mesh-topic.
 * Crée le runtime, indexe les ressources, et retourne le handle public.
 */
@Injectable()
export class MeshTopicRegistryService {
    private readonly runtimes = new Map<
        string,
        MeshTopicNamespaceRuntime<EventContracts>
    >();

    constructor(
        private readonly streamPool: CoreEventStreamPoolService,
        private readonly publisher: MeshTopicPublisherService,
        private readonly queryBus: MeshTopicQueryBusService,
        private readonly resourceIndex: MeshTopicResourceIndexService,
    ) {}

    register<TContracts extends EventContracts>(
        definition: MeshTopicNamespaceDefinition<TContracts>,
    ): MeshTopicNamespaceHandle<TContracts> {
        const namespace = definition.namespace.trim();

        if (!namespace) {
            throw new MeshTopicNamespaceNotFoundError("(empty)");
        }

        if (this.runtimes.has(namespace)) {
            throw new MeshTopicNamespaceAlreadyRegisteredError(namespace);
        }

        const topicNames = Object.keys(definition.contracts) as (keyof TContracts & string)[];
        if (topicNames.length === 0) {
            throw new MeshTopicNamespaceNotFoundError(namespace);
        }

        const runtime = new MeshTopicNamespaceRuntime(
            namespace,
            definition.contracts,
            this.streamPool,
        );

        this.runtimes.set(
            namespace,
            runtime as unknown as MeshTopicNamespaceRuntime<EventContracts>,
        );

        this.resourceIndex.indexTopics(
            namespace,
            topicNames,
            definition.organizationId ?? null,
        );

        return this.buildHandle(namespace, runtime, topicNames);
    }

    has(namespace: string): boolean {
        return this.runtimes.has(namespace);
    }

    getRuntime(namespace: string): MeshTopicNamespaceRuntime<EventContracts> | undefined {
        return this.runtimes.get(namespace);
    }

    getRuntimeOrThrow(namespace: string): MeshTopicNamespaceRuntime<EventContracts> {
        const runtime = this.runtimes.get(namespace);
        if (!runtime) throw new MeshTopicNamespaceNotFoundError(namespace);
        return runtime;
    }

    // ─── Handle factory ───────────────────────────────────────────────────────

    private buildHandle<TContracts extends EventContracts>(
        namespace: string,
        runtime: MeshTopicNamespaceRuntime<TContracts>,
        topicNames: (keyof TContracts & string)[],
    ): MeshTopicNamespaceHandle<TContracts> {
        const runtimeAsGeneric = runtime as unknown as MeshTopicNamespaceRuntime<EventContracts>;

        return {
            namespace,
            topics: topicNames,

            publish: (topic, input, output, options) =>
                this.publisher.publish(namespace, runtime, String(topic), input, output, options),

            subscribe: (topic, input, options) =>
                runtime.subscribe(topic, input, options),

            observe$: (topic, input, options) =>
                runtime.subscribe$(topic, input, options),

            queryByInput$: (topic, options) =>
                runtime.queryByInput$(topic, options),

            lookupRoute: (topic, options) =>
                this.resourceIndex.lookupTopic(namespace, String(topic), options),

            request: (requestTopic, responseTopic, input, options) =>
                this.queryBus.request(
                    namespace,
                    runtimeAsGeneric,
                    String(requestTopic),
                    String(responseTopic),
                    input,
                    options,
                )  as unknown as Promise<ReturnType<typeof responseTopic extends never ? never : () => unknown>>,

            registerQueryHandler: (requestTopic, responseTopic, handler) =>
                this.queryBus.registerHandler(
                    namespace,
                    runtimeAsGeneric,
                    String(requestTopic),
                    String(responseTopic),
                    async (input) => handler(input as Parameters<typeof handler>[0]),
                ),
        };
    }
}