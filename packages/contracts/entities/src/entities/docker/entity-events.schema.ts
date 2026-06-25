import z from 'zod/v4'
import { dockerContainerEntitySchema } from './containers'
import { dockerImageEntitySchema } from './images'
import { dockerNetworkEntitySchema } from './networks'
import { dockerVolumeEntitySchema } from './volumes'

/**
 * Canonical kinds supported by the unified docker entity event stream.
 * Every kind has exactly one action enum (see `dockerXxxRuntimeActionSchema`)
 * and one entity schema (see `dockerXxxEntitySchema`).
 */
export const dockerEntityKindSchema = z.enum([
  'container',
  'image',
  'network',
  'volume',
])
export type DockerEntityKind = z.infer<typeof dockerEntityKindSchema>

/**
 * What "remove from store" means. A removed entity is referenced by id only.
 */
export const dockerEntityRemovedEventSchema = z.object({
  kind: dockerEntityKindSchema,
  action: z.enum(['destroy', 'die', 'delete']),
  id: z.string().min(1),
  /**
   * ISO timestamp of the underlying docker event. Useful for ordering when
   * the stream is consumed by `useDockerLiveEntities` (the hook uses this
   * to drop late events that race with a `reconcile()`).
   */
  occurredAt: z.string(),
  /**
   * Optional raw event fingerprint for diagnostics / debug only.
   */
  eventId: z.string().nullable(),
})
export type DockerEntityRemovedEvent = z.infer<typeof dockerEntityRemovedEventSchema>

/**
 * Every event the unified docker entity stream can emit. Each variant
 * carries the **full entity payload** (with relations) so the client can
 * patch its in-memory store in one shot — no per-event follow-up fetch
 * is required.
 *
 * Use the discriminator `kind` (and the action semantics) to drive your
 * reducer. `useDockerLiveEntities` provides a default reducer that does
 * the right thing for `create` / `update` / `destroy` / `die` / `delete`
 * out of the box.
 */
export const dockerEntityEventSchema = z.discriminatedUnion('kind', [
  dockerContainerEntitySchema.extend({
    kind: z.literal('container'),
    action: z.string().min(1),
    occurredAt: z.string(),
    eventId: z.string().nullable(),
  }),
  dockerImageEntitySchema.extend({
    kind: z.literal('image'),
    action: z.string().min(1),
    occurredAt: z.string(),
    eventId: z.string().nullable(),
  }),
  dockerNetworkEntitySchema.extend({
    kind: z.literal('network'),
    action: z.string().min(1),
    occurredAt: z.string(),
    eventId: z.string().nullable(),
  }),
  dockerVolumeEntitySchema.extend({
    kind: z.literal('volume'),
    action: z.string().min(1),
    occurredAt: z.string(),
    eventId: z.string().nullable(),
  }),
])
export type DockerEntityEvent = z.infer<typeof dockerEntityEventSchema>

/**
 * Wrapper around the discriminated union so a server can send a single
 * `DockerEntityStreamChunk` per emission, even if the entity is gone.
 */
export const dockerEntityStreamChunkSchema = z.union([
  dockerEntityEventSchema,
  dockerEntityRemovedEventSchema,
])
export type DockerEntityStreamChunk = z.infer<typeof dockerEntityStreamChunkSchema>

/**
 * Filter input for the unified `docker.entity.stream` contract.
 *
 * Pass `kinds: ['container', 'image']` to only receive events for those
 * kinds (saves bandwidth + reduces client-side filtering). Use the
 * `actions` per kind to further narrow down the set of emitted events
 * (e.g. only `['create', 'update', 'destroy']` for containers).
 */
export const dockerEntityStreamQuerySchema = z.object({
  kinds: z.array(dockerEntityKindSchema).min(1).optional(),
  /**
   * Map of `kind -> action[]`. When omitted for a given kind, every
   * action of that kind is emitted.
   */
  actions: z
    .object({
      container: z.array(z.string().min(1)).optional(),
      image: z.array(z.string().min(1)).optional(),
      network: z.array(z.string().min(1)).optional(),
      volume: z.array(z.string().min(1)).optional(),
    })
    .partial()
    .optional(),
})
export type DockerEntityStreamQuery = z.infer<typeof dockerEntityStreamQuerySchema>
