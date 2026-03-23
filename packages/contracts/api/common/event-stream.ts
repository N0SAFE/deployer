import z from "zod/v4";

export const coreEventScopeSchema = z.enum(["global", "tenant", "project", "service", "deployment"]);
export type CoreEventScope = z.infer<typeof coreEventScopeSchema>;

export const coreEventStreamDefinitionSchema = z.object({
    id: z.uuid(),
    name: z.string().min(1),
    namespace: z.string().min(1),
    description: z.string().nullable(),
    isActive: z.boolean(),
    scope: coreEventScopeSchema,
    scopeId: z.string().nullable(),
    filters: z.record(z.string(), z.unknown()).nullable(),
    replayDefault: z.boolean(),
    replayLimitDefault: z.number().int().min(1).max(500),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type CoreEventStreamDefinition = z.infer<typeof coreEventStreamDefinitionSchema>;

/**
 * Canonical domain-event envelope.
 *
 * Responsibility boundary (T268):
 * - Domain modules define semantics using this envelope.
 * - Mesh transport carries this envelope but does not redefine business meaning.
 */
export const coreDomainEventEnvelopeSchema = z.object({
    eventId: z.uuid(),
    aggregateType: z.string().min(1),
    aggregateId: z.string().min(1),
    eventType: z.string().min(1),
    version: z.string().min(1),
    occurredAt: z.string(),
    traceId: z.string().min(1).optional(),
    causationId: z.string().min(1).optional(),
    payload: z.unknown(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type CoreDomainEventEnvelope = z.infer<typeof coreDomainEventEnvelopeSchema>;

export const coreSyncedEventEnvelopeSchema = z.object({
    streamId: z.uuid(),
    namespace: z.string(),
    eventName: z.string(),
    payload: z.unknown(),
    sequence: z.number().int().nonnegative().optional(),
    replayed: z.boolean().optional(),
    emittedAt: z.string().optional(),
});
export type CoreSyncedEventEnvelope = z.infer<typeof coreSyncedEventEnvelopeSchema>;
