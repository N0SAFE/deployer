import * as z from "zod";
import { oc } from "@orpc/contract";
import { route } from "@repo/orpc-utils/builder";
import { createFilterConfig, standard, type ComputeInputSchema } from "@repo/orpc-utils";
import {
    coreEventStreamDefinitionSchema,
    coreEventScopeSchema,
    coreSyncedEventEnvelopeSchema,
} from "@repo/api-contracts/common/event-stream";

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
export const coreEventStreamListContract = coreEventStreamOps.list(coreEventStreamListConfig).build();
export type CoreEventStreamListInput = ComputeInputSchema<typeof coreEventStreamListConfigSchemas>;

export const coreEventStreamFindByIdContract = coreEventStreamOps.read().build();

const coreStreamReplayQuerySchema = z.object({
    replay: z.coerce.boolean().default(true),
    replayLimit: z.coerce.number().int().min(1).max(500).default(1),
});

export const coreEventSyncStreamContract = route({
    method: "GET",
    path: "/sync/{id}/stream",
    summary: "Stream synced events for a core stream definition",
    description:
        "Generic core synchronization stream endpoint. Business modules only need to register namespace adapters.",
})
    .input((b) =>
        b
            .params((p) => p`/sync/${p("id", z.uuid())}/stream`)
            .query(coreStreamReplayQuerySchema),
    )
    .output((b) => b.streamed(coreSyncedEventEnvelopeSchema))
    .build();

export const eventSyncContract = oc.tag("Core Event Sync").prefix("/events").router({
    listStreams: coreEventStreamListContract,
    findStreamById: coreEventStreamFindByIdContract,
    streamSync: coreEventSyncStreamContract,
});

export type EventSyncContract = typeof eventSyncContract;
