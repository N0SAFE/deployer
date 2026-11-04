import { Effect } from "effect"
import { Observable, filter, map, type Subscriber } from "rxjs"

import type { DockerEntityStreamChunk, DockerRuntimeEvent } from "@deployer/contracts-entities"
import type { EffectHostShape } from "@deployer/nest-effect"
import type { DockerEntityStreamInput } from "@deployer/runtime-contracts/modules/docker/entity/shared"
import type { CoreEventStreamPoolServiceShape } from "@deployer/shared/core/modules/events/base/index"

import { DockerEntityDomainService } from "./docker-entity-domain.service"
import { entityDebug } from "./docker-entity-orchestrator.service"
import { coerceStreamChunk, type EntityChunkLog } from "./entity-chunks"
import { buildStreamFilter, eventMatchesFilter, poolKeyFor, type EntityFilterInput } from "./entity-stream-rules"

import type { DockerEntityCacheService } from "./docker-entity-cache.service"
import type { DockerRuntimeEventsStreamShape } from "../../../common/events/docker-runtime-events-stream.service"

/** The entity event stream, kept as RxJS so the oRPC streaming handler keeps its shape. */
export type DockerEntityStreamsShape = {
  readonly streamEntities: (input: DockerEntityStreamInput) => Observable<DockerEntityStreamChunk>
}

/** What the stream needs at construction; every field is a plain Nest provider except the host. */
export type DockerEntityStreamsDeps = {
  readonly host: EffectHostShape
  readonly events: Pick<DockerRuntimeEventsStreamShape, "observeEvents">
  readonly pool: CoreEventStreamPoolServiceShape
  readonly cache: DockerEntityCacheService
  readonly log: EntityChunkLog
}

const ENTITY_SOURCES = new Set<string>(["container", "image", "network", "volume"])

/**
 * The RxJS boundary of `docker.entity`: subscriptions are pooled per (kinds, actions) tuple, each docker event
 * invalidates the list cache, and enrichment runs the domain's `enrichEvent` on the app's `EffectHost`.
 */
export function entityStreamsOver({ host, events, pool, cache, log }: DockerEntityStreamsDeps): DockerEntityStreamsShape {
  const createEntityStream = (filter: ReturnType<typeof buildStreamFilter>) =>
    new Observable<DockerEntityStreamChunk>((subscriber: Subscriber<DockerEntityStreamChunk>) => {
      const subscription = events.observeEvents().subscribe({
        next: (event: DockerRuntimeEvent) => {
          // Invalidate the per-kind list cache on any docker event for that kind. The TTL is 2s, so this is a defensive
          // optimization on top of the natural decay — but it matters when the same page holds a long-lived
          // subscription and the list query fires at high frequency.
          if (ENTITY_SOURCES.has(event.source)) {
            cache.invalidate(event.source as Parameters<DockerEntityCacheService["invalidate"]>[0])
          }
          if (!eventMatchesFilter(event, filter)) {
            return
          }
          void host
            .runUnwrapped(
              Effect.gen(function* () {
                const domain = yield* DockerEntityDomainService
                return yield* domain.enrichEvent(event)
              }),
            )
            .then((chunk) => {
              if (chunk) {
                subscriber.next(chunk)
              }
            })
            .catch((error: unknown) => {
              log.debug("enrichEvent", {
                phase: "enrich_failed",
                message: error instanceof Error ? error.message : String(error),
              })
            })
        },
        error: (error: unknown) => {
          subscriber.error(error)
        },
        complete: () => {
          subscriber.complete()
        },
      })
      return () => {
        subscription.unsubscribe()
      }
    })

  return {
    streamEntities: (input) => {
      entityDebug("streamEntities", {
        kinds: input.kinds,
        actions: input.actions,
      })
      const filterInput: EntityFilterInput = { kinds: input.kinds, actions: input.actions }
      return pool
        .observePooledStream<DockerEntityStreamChunk>(
          poolKeyFor(filterInput),
          () => createEntityStream(buildStreamFilter(filterInput)),
          { bufferSize: 1 },
        )
        .pipe(
          // ORPC validates output only on a synchronous return, not on each emission, so the producer coerces every
          // chunk itself and drops the ones the contract rejects.
          map((chunk) => coerceStreamChunk(chunk, log)),
          filter((chunk): chunk is DockerEntityStreamChunk => chunk !== null),
        )
    },
  }
}
