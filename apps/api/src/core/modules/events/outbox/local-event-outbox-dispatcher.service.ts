import { Injectable, Logger } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { AppLifecycleService, AppLifecyclePhase } from "@repo/nest-lifecycle";
import { coreDomainEventEnvelopeSchema } from "@repo/contracts-entities";
import { LocalEventOutboxRepository } from "./local-event-outbox.repository";

const DEFAULT_NODE_ID = "00000000-0000-4000-8000-000000000000";

@Injectable()
export class LocalEventOutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(LocalEventOutboxDispatcherService.name);
    private readonly pollIntervalMs = 3_000;
    private readonly maxRetries = 8;
    private ticker: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly databaseService: GlobalDatabaseService,
        private readonly outboxRepository: LocalEventOutboxRepository,
        private readonly lifecycle: AppLifecycleService,
    ) {}

    onModuleInit(): void {
        this.ticker = setInterval(() => {
            // Only dispatch once the application has reached a phase where the
            // global database pool is guaranteed to point at a real URL.
            //
            // `isInitialized` alone is NOT sufficient: GlobalDatabaseModule
            // creates a placeholder pool (empty connection string) at module
            // init when no URL is in SQLite yet, and the orchestrator resolves
            // the real URL later. Polling against the placeholder pool fails
            // every 3s until the orchestrator finishes — the exact symptom
            // seen in startup logs ("dispatchPending error (will retry)").
            //
            // Gate on lifecycle phase instead: READY (or DEGRADED, which means
            // the pool exists but had transient failures) implies the pool was
            // re-pointed at the real database.
            const phase = this.lifecycle.phase;
            if (phase !== AppLifecyclePhase.READY && phase !== AppLifecyclePhase.DEGRADED) {
                return;
            }
            this.dispatchPending().catch((err: unknown) => {
                this.logger.warn(`dispatchPending error (will retry): ${this.describeError(err)}`);
            });
        }, this.pollIntervalMs);

        if (this.ticker && typeof this.ticker.unref === "function") {
            this.ticker.unref();
        }
    }

    onModuleDestroy(): void {
        if (this.ticker) {
            clearInterval(this.ticker);
            this.ticker = null;
        }
    }

    /**
     * Format an error including its underlying cause chain.
     *
     * Drizzle's `DrizzleQueryError` only formats `query + params` — the actual
     * database error (e.g. `ECONNREFUSED`, `no such table`, `database is
     * locked`) lives in `error.cause`. Without it, debugging the outbox
     * failure is guesswork.
     */
    private describeError(err: unknown): string {
        if (!(err instanceof Error)) {
            return String(err);
        }
        const parts: string[] = [err.message];
        let cause: unknown = (err as Error & { cause?: unknown }).cause;
        let depth = 0;
        while (cause instanceof Error && depth < 3) {
            parts.push(`cause[${depth}]=${cause.message}`);
            cause = (cause as Error & { cause?: unknown }).cause;
            depth += 1;
        }
        return parts.join(" | ");
    }

    async enqueue(input: {
        topic: string;
        payload: Record<string, unknown>;
        nodeId?: string | null;
    }): Promise<void> {
        await this.outboxRepository.enqueue({
            ...input,
            nodeId: this.resolveNodeId(input.nodeId ?? null),
        });
    }

    async dispatchPending(limit = 50): Promise<void> {
        const dueRows = await this.outboxRepository.findDue(limit);

        for (const row of dueRows) {
            await this.dispatchOne(row.id);
        }
    }

    private async dispatchOne(outboxId: string): Promise<void> {
        const row = await this.outboxRepository.findById(outboxId);

        if (row?.state !== "pending") {
            return;
        }

        const parsed = coreDomainEventEnvelopeSchema.safeParse(row.payload);
        if (!parsed.success) {
            // An invalid envelope will never parse on retry — dead-letter it
            // immediately instead of burning through the retry budget.
            await this.outboxRepository.markDeadLetter(row.id, row.retryCount);
            this.logger.error(`Outbox item '${row.id}' moved to dead-letter: invalid_envelope_schema`);
            return;
        }

        const eventId = parsed.data.eventId;
        const duplicateAlreadySent = await this.hasSentDuplicateEventId(row.id, eventId);
        if (duplicateAlreadySent) {
            await this.markSent(row.id);
            return;
        }

        try {
            // Dispatch bridge placeholder:
            // the canonical payload has been schema-validated above.
            // In this phase, marking as sent is sufficient to unblock transactional outbox flow.
            await this.markSent(row.id);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.scheduleRetryOrDeadLetter(row.id, row.retryCount, message);
        }
    }

    private async hasSentDuplicateEventId(currentId: string, eventId: string): Promise<boolean> {
        return this.outboxRepository.hasSentDuplicateEventId(currentId, eventId);
    }

    private async markSent(id: string): Promise<void> {
        await this.outboxRepository.markSent(id);
    }

    private async scheduleRetryOrDeadLetter(id: string, retryCount: number, reason: string): Promise<void> {
        const outcome = await this.outboxRepository.scheduleRetry(id, retryCount, this.maxRetries);

        if (outcome === "retry") {
            this.logger.warn(`Outbox dispatch retry scheduled for '${id}': ${reason}`);
            return;
        }
        this.logger.error(`Outbox item '${id}' moved to dead-letter: ${reason}`);
    }

    private resolveNodeId(nodeId: string | null): string {
        if (nodeId && nodeId.trim().length > 0) {
            return nodeId;
        }

        const envNodeId = process.env.MESH_NODE_ID?.trim();
        if (envNodeId && envNodeId.length > 0) {
            return envNodeId;
        }

        return DEFAULT_NODE_ID;
    }
}
