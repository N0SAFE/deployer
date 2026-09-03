import z from "zod/v4";
import { coreDomainEventEnvelopeSchema } from "../event-stream";

export const meshControlEnvelopeTypeSchema = z.enum([
    "hello",
    "heartbeat",
    "membership_suspect",
    "membership_confirm",
    "membership_remove",
    "anti_entropy_sync",
    "topology_delta",
    "queue_forward",
    "queue_transition",
    "event_publish",
    "event_replay_request",
    "event_replay_chunk",
    "trust_keyring_sync",
    "trust_keyring_ack",
    "trust_strict_mode_sync",
]);
export type MeshControlEnvelopeType = z.infer<typeof meshControlEnvelopeTypeSchema>;

export const meshControlEnvelopeSchema = z.object({
    envelopeId: z.uuid(),

    keyId: z.string().min(1).optional(),
    algorithm: z.enum(["HS256"]).optional(),
    signature: z.string().min(1).optional(),
    type: meshControlEnvelopeTypeSchema,
    sourceNodeId: z.uuid(),
    targetNodeId: z.uuid().nullable(),
    partitionKey: z.string().min(1).optional(),
    traceId: z.string().min(1).optional(),
    hop: z.number().int().min(0).default(0),
    maxHops: z.number().int().min(1).max(64).default(16),
    emittedAt: z.string(),
    payload: z.record(z.string(), z.unknown()),
});
export type MeshControlEnvelope = z.infer<typeof meshControlEnvelopeSchema>;

export const meshControlEnvelopeAckSchema = z.object({
    accepted: z.boolean(),
    envelopeId: z.uuid(),
    forwardedTo: z.array(z.uuid()),
});
export type MeshControlEnvelopeAck = z.infer<typeof meshControlEnvelopeAckSchema>;

export const meshControlEnvelopePublishResultSchema = meshControlEnvelopeAckSchema;
export type MeshControlEnvelopePublishResult = z.infer<typeof meshControlEnvelopePublishResultSchema>;

/**
 * Typed payload contracts for event transport over mesh control envelopes.
 *
 * Boundary (T268): mesh carries validated domain-event envelopes and replay chunks,
 * but does not own domain event semantics.
 */
export const meshEventPublishPayloadSchema = z.object({
    event: coreDomainEventEnvelopeSchema,
    replayCursor: z.string().min(1).optional(),
    sequence: z.number().int().nonnegative().optional(),
});
export type MeshEventPublishPayload = z.infer<typeof meshEventPublishPayloadSchema>;

export const meshEventReplayChunkPayloadSchema = z.object({
    events: z.array(coreDomainEventEnvelopeSchema),
    fromCursor: z.string().min(1).optional(),
    nextCursor: z.string().min(1).nullable().optional(),
    hasMore: z.boolean().default(false),
});
export type MeshEventReplayChunkPayload = z.infer<typeof meshEventReplayChunkPayloadSchema>;
