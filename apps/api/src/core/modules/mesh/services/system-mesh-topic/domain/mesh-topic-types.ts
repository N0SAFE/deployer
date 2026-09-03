import z from "zod/v4";
import type { Observable } from "rxjs";
import type {
    AnyEventEmission,
    EventSubscription,
} from "@repo/nest-events";
import type {
    EventContracts,
    EventInput,
    EventOutput,
} from "@repo/nest-events";
import type { MeshResourceLookupResult } from "@repo/contracts-entities";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const meshTopicEventPayloadSchema = z.object({
    namespace: z.string().min(1),
    topic: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    output: z.record(z.string(), z.unknown()),
});

export type MeshTopicEventPayload = z.infer<typeof meshTopicEventPayloadSchema>;

// ─── Options ──────────────────────────────────────────────────────────────────

export interface MeshTopicReplayOptions {
    replayLimit?: number;
    includePersisted?: boolean;
}

export interface MeshTopicRequestOptions {
    timeoutMs?: number;
    traceId?: string;
    partitionKey?: string;
}

export interface MeshTopicQueryOptions<TInput> extends MeshTopicReplayOptions {
    fuzzy?: string;
    predicate?: (input: TInput) => boolean;
}

export interface MeshTopicPublishOptions {
    traceId?: string;
    partitionKey?: string;
    propagate?: boolean;
}

// ─── Namespace definition & handle ────────────────────────────────────────────

export interface MeshTopicNamespaceDefinition<TContracts extends EventContracts> {
    namespace: string;
    contracts: TContracts;
}

export interface MeshTopicNamespaceHandle<TContracts extends EventContracts> {
    readonly namespace: string;
    readonly topics: (keyof TContracts & string)[];
    publish<K extends keyof TContracts>(
        topic: K,
        input: EventInput<TContracts[K]>,
        output: EventOutput<TContracts[K]>,
        options?: MeshTopicPublishOptions,
    ): void;
    subscribe<K extends keyof TContracts>(
        topic: K,
        input: EventInput<TContracts[K]>,
        options?: MeshTopicReplayOptions,
    ): EventSubscription<TContracts[K]>;
    observe$<K extends keyof TContracts>(
        topic: K,
        input: EventInput<TContracts[K]>,
        options?: MeshTopicReplayOptions,
    ): Observable<EventOutput<TContracts[K]>>;
    queryByInput$<K extends keyof TContracts>(
        topic: K,
        options?: MeshTopicQueryOptions<EventInput<TContracts[K]>>,
    ): Observable<AnyEventEmission<TContracts[K]>>;
    lookupRoute<K extends keyof TContracts>(
        topic: K,
        options?: { organizationId?: string | null; includeCandidates?: boolean },
    ): MeshResourceLookupResult;
    request<KReq extends keyof TContracts, KRes extends keyof TContracts>(
        requestTopic: KReq,
        responseTopic: KRes,
        input: EventInput<TContracts[KReq]>,
        options?: MeshTopicRequestOptions,
    ): Promise<EventOutput<TContracts[KRes]>>;
    registerQueryHandler<KReq extends keyof TContracts, KRes extends keyof TContracts>(
        requestTopic: KReq,
        responseTopic: KRes,
        handler: (
            input: EventInput<TContracts[KReq]>,
        ) => EventOutput<TContracts[KRes]> | Promise<EventOutput<TContracts[KRes]>>,
    ): () => void;
}

// ─── Internes ─────────────────────────────────────────────────────────────────

export interface PendingMeshQuery {
    namespace: string;
    responseTopic: string;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
}

export interface MeshQueryHandlerRegistration {
    namespace: string;
    requestTopic: string;
    responseTopic: string;
    handler: (input: unknown) => Promise<unknown>;
    parseInput: (topic: string, input: unknown) => unknown;
    parseOutput: (topic: string, output: unknown) => unknown;
}