import { Context, Effect } from "effect";

import { coreDomainEventEnvelopeSchema } from "@deployer/contracts-entities";
import { resolveNodeId } from "@deployer/env";
import { AppLifecyclePhase, type AppLifecycleShape } from "@deployer/lifecycle";
import type { ServiceLifecycleShape } from "@deployer/nest-effect";

import type { StorageFailure } from "../../database/storage";

import type { LocalEventOutboxRepositoryShape, OutboxRow } from "./local-event-outbox.repository";

const POLL_INTERVAL_MS = 3_000;
const MAX_RETRIES = 8;

export type LocalEventOutboxDispatcherServiceShape = ServiceLifecycleShape & {
    /** Queue a payload; its envelope's event id is lifted into its own column so a duplicate enqueue is rejected. */
    readonly enqueue: (input: {
        topic: string;
        payload: Record<string, unknown>;
        nodeId?: string | null;
    }) => Effect.Effect<void, StorageFailure>;
    /**
     * Claim and dispatch one batch. The rows come back FROM the claim, so each is processed without a second read — see
     * `LocalEventOutboxRepository.claimDue`.
     */
    readonly dispatchPending: (limit?: number) => Effect.Effect<void, StorageFailure>;
};

type Ports = {
    readonly outbox: LocalEventOutboxRepositoryShape;
    readonly lifecycle: Pick<AppLifecycleShape, "stateNow">;
    /** Overridable cadence, for a spec. */
    readonly pollIntervalMs?: number;
};

const resolveNode = (nodeId: string | null): string => (nodeId && nodeId.trim().length > 0 ? nodeId : resolveNodeId());

/**
 * Format an error including its underlying cause chain.
 *
 * Drizzle's `DrizzleQueryError` only formats `query + params` — the actual database error (e.g. `ECONNREFUSED`, `no such
 * table`, `database is locked`) lives in `error.cause`. Without it, debugging the outbox failure is guesswork.
 */
const describeError = (err: unknown): string => {
    if (!(err instanceof Error)) return String(err);
    const parts: string[] = [err.message];
    let cause: unknown = err.cause;
    let depth = 0;
    while (cause instanceof Error && depth < 3) {
        parts.push(`cause[${String(depth)}]=${cause.message}`);
        cause = cause.cause;
        depth += 1;
    }
    return parts.join(" | ");
};

export function makeLocalEventOutboxDispatcherService({ outbox, lifecycle, pollIntervalMs = POLL_INTERVAL_MS }: Ports): LocalEventOutboxDispatcherServiceShape {
    /** Dispatch a row this process already owns (the claim returned the full row: re-reading it would be one extra query per event). */
    const dispatchClaimed = (row: OutboxRow) =>
        Effect.gen(function* () {
            const parsed = coreDomainEventEnvelopeSchema.safeParse(row.payload);
            if (!parsed.success) {
                // An invalid envelope will never parse on retry — dead-letter it immediately instead of burning through the retry budget.
                yield* outbox.markDeadLetter(row.id, row.retryCount);
                yield* Effect.logError(`Outbox item '${row.id}' moved to dead-letter: invalid_envelope_schema`);
                return;
            }

            if (yield* outbox.hasSentDuplicateEventId(row.id, parsed.data.eventId)) {
                yield* outbox.markSent(row.id);
                return;
            }

            // Dispatch bridge placeholder: the canonical payload has been schema-validated above. In this phase, marking as
            // sent is sufficient to unblock transactional outbox flow. A failure schedules a retry (or dead-letters).
            yield* outbox.markSent(row.id).pipe(
                Effect.catch((error) =>
                    Effect.gen(function* () {
                        const reason = describeError(error);
                        const outcome = yield* outbox.scheduleRetry(row.id, row.retryCount, MAX_RETRIES);
                        if (outcome === "retry") yield* Effect.logWarning(`Outbox dispatch retry scheduled for '${row.id}': ${reason}`);
                        else yield* Effect.logError(`Outbox item '${row.id}' moved to dead-letter: ${reason}`);
                    }),
                ),
            );
        });

    const dispatchPending: LocalEventOutboxDispatcherServiceShape["dispatchPending"] = (limit = 50) =>
        Effect.gen(function* () {
            const claimed = yield* outbox.claimDue(limit, resolveNode(null));
            for (const row of claimed) yield* dispatchClaimed(row);
        });

    return {
        enqueue: (input) =>
            Effect.suspend(() => {
                // Lift the envelope's eventId into its own column so the unique index can reject a duplicate enqueue. A payload
                // that is not a valid envelope keeps a null id: it will be dead-lettered on dispatch, and nulls are exempt from
                // the partial unique index.
                const parsed = coreDomainEventEnvelopeSchema.safeParse(input.payload);
                return outbox.enqueue({
                    ...input,
                    nodeId: resolveNode(input.nodeId ?? null),
                    eventId: parsed.success ? parsed.data.eventId : null,
                });
            }),
        dispatchPending,

        // The runner owns the fiber and interrupts it at shutdown.
        run: () =>
            Effect.forever(
                Effect.sleep(pollIntervalMs).pipe(
                    Effect.andThen(
                        Effect.suspend(() => {
                            // Only dispatch once the application has reached a phase where the global database pool is
                            // guaranteed to point at a real URL. `isInitialized` alone is NOT sufficient: GlobalDatabaseModule
                            // creates a placeholder pool (empty connection string) at module init when no URL is in SQLite yet,
                            // and the orchestrator resolves the real URL later. Polling against the placeholder pool fails every
                            // 3s until the orchestrator finishes. READY (or DEGRADED: the pool exists but had transient
                            // failures) implies the pool was re-pointed at the real database.
                            const phase = lifecycle.stateNow().phase;
                            if (phase !== AppLifecyclePhase.READY && phase !== AppLifecyclePhase.DEGRADED) return Effect.void;
                            return dispatchPending().pipe(
                                Effect.catch((err) => Effect.logWarning(`dispatchPending error (will retry): ${describeError(err.cause ?? err)}`)),
                            );
                        }),
                    ),
                ),
            ),
    };
}

export class LocalEventOutboxDispatcherService extends Context.Service<
    LocalEventOutboxDispatcherService,
    LocalEventOutboxDispatcherServiceShape
>()("shared/LocalEventOutboxDispatcherService") {}
