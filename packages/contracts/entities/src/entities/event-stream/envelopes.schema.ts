import z from 'zod/v4'

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
})
export type CoreDomainEventEnvelope = z.infer<typeof coreDomainEventEnvelopeSchema>

export const coreSyncedEventEnvelopeSchema = z.object({
  streamId: z.uuid(),
  namespace: z.string(),
  eventName: z.string(),
  payload: z.unknown(),
  sequence: z.number().int().nonnegative().optional(),
  replayed: z.boolean().optional(),
  emittedAt: z.string().optional(),
})
export type CoreSyncedEventEnvelope = z.infer<typeof coreSyncedEventEnvelopeSchema>
