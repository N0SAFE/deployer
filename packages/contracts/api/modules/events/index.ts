import z from "zod/v4";
import { oc } from "@orpc/contract";
import { createFilterConfig, standard, standardDomainErrorContracts, type ComputeInputSchema } from "@repo/orpc-utils";
import {
    coreEventStreamDefinitionSchema,
    coreEventScopeSchema,
    coreSyncedEventEnvelopeSchema,
} from "@repo/contracts-entities";

const coreEventStreamOps = standard.zod(coreEventStreamDefinitionSchema, "coreEventStream");

const coreEventStreamListConfig = createFilterConfig(coreEventStreamOps)
    .withPagination({
        defaultLimit: 20,
        maxLimit: 100,
        includeOffset: true,
    } as const)
    .withSorting(["createdAt", "updatedAt", "name", "namespace"] as const, {
        defaultField: "createdAt",
        defaultDirection: "desc",
    })
    .withFiltering({
        name: {
            schema: coreEventStreamDefinitionSchema.shape.name,
            operators: ["eq", "like", "ilike"] as const,
        },
        namespace: {
            schema: coreEventStreamDefinitionSchema.shape.namespace,
            operators: ["eq", "like", "ilike"] as const,
        },
        isActive: {
            schema: coreEventStreamDefinitionSchema.shape.isActive,
            operators: ["eq"] as const,
        },
        scope: {
            schema: coreEventScopeSchema,
            operators: ["eq"] as const,
        },
        scopeId: {
            schema: coreEventStreamDefinitionSchema.shape.scopeId,
            operators: ["eq"] as const,
        },
        createdBy: {
            schema: coreEventStreamDefinitionSchema.shape.createdBy,
            operators: ["eq"] as const,
        },
    })
    .buildConfig();

export const coreEventStreamListConfigSchemas = coreEventStreamListConfig;
export const coreEventStreamListContract = coreEventStreamOps
    .list(coreEventStreamListConfig)
    .errors((e) => [
        // 403 when the caller lacks stream visibility.
        ...standardDomainErrorContracts(e),
    ])
    .build();
export type CoreEventStreamListInput = ComputeInputSchema<typeof coreEventStreamListConfigSchemas>;

export const coreEventStreamFindByIdContract = coreEventStreamOps
    .read()
    .errors((e) => [
        // 404 for unknown stream id.
        ...standardDomainErrorContracts(e),
    ])
    .build();

const coreStreamReplayQuerySchema = z.object({
    replay: z.coerce.boolean().default(true),
    replayLimit: z.coerce.number().int().min(1).max(500).default(1),
});

const coreEventSyncStreamOps = standard.zod(coreSyncedEventEnvelopeSchema, "coreEventSyncStream");

export const coreEventSyncStreamContract = coreEventSyncStreamOps
    .list()
    .input((b) =>
        b
            .params((p) => p`/sync/${p("id", z.uuid())}/stream`)
            .query(coreStreamReplayQuerySchema),
    )
    .output((b) => b.observable(coreSyncedEventEnvelopeSchema))
    .errors((e) => [
        // 404 for unknown stream id; 403 when not a mesh peer.
        ...standardDomainErrorContracts(e),
    ])
    .build();

export const eventSyncContract = oc.tag("Core Event Sync").prefix("/events").router({
    listStreams: coreEventStreamListContract,
    findStreamById: coreEventStreamFindByIdContract,
    streamSync: coreEventSyncStreamContract,
});

export type EventSyncContract = typeof eventSyncContract;
