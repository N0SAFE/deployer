import { Injectable, Logger } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { localEventOutbox } from "@/config/drizzle/global/schema/runtime";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { coreDomainEventEnvelopeSchema } from "@repo/contracts-entities";

const DEFAULT_NODE_ID = "00000000-0000-4000-8000-000000000000";

@Injectable()
export class LocalEventOutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(LocalEventOutboxDispatcherService.name);
    private readonly pollIntervalMs = 3_000;
    private readonly maxRetries = 8;
    private ticker: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly databaseService: GlobalDatabaseService) {}

    onModuleInit(): void {
        this.ticker = setInterval(() => {
            void this.dispatchPending();
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

    async enqueue(input: {
        topic: string;
        payload: Record<string, unknown>;
        nodeId?: string | null;
    }): Promise<void> {
        const now = new Date();
        await this.databaseService.db.insert(localEventOutbox).values({
            id: randomUUID(),
            nodeId: this.resolveNodeId(input.nodeId ?? null),
            topic: input.topic,
            payload: input.payload,
            state: "pending",
            retryCount: 0,
            nextRetryAt: now,
            createdAt: now,
            updatedAt: now,
        });
    }

    async dispatchPending(limit = 50): Promise<void> {
        const now = new Date();
        const dueRows = await this.databaseService.db
            .select()
            .from(localEventOutbox)
            .where(
                and(
                    eq(localEventOutbox.state, "pending"),
                    isNotNull(localEventOutbox.nextRetryAt),
                    lte(localEventOutbox.nextRetryAt, now),
                ),
            )
            .orderBy(asc(localEventOutbox.createdAt))
            .limit(limit);

        for (const row of dueRows) {
            await this.dispatchOne(row.id);
        }
    }

    private async dispatchOne(outboxId: string): Promise<void> {
        const [row] = await this.databaseService.db
            .select()
            .from(localEventOutbox)
            .where(eq(localEventOutbox.id, outboxId))
            .limit(1);

        if (row?.state !== "pending") {
            return;
        }

        const parsed = coreDomainEventEnvelopeSchema.safeParse(row.payload);
        if (!parsed.success) {
            await this.markDeadLetter(row.id, row.retryCount, "invalid_envelope_schema");
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
        const rows = await this.databaseService.db
            .select({ id: localEventOutbox.id })
            .from(localEventOutbox)
            .where(
                and(
                    eq(localEventOutbox.state, "sent"),
                    sql`(${localEventOutbox.payload} ->> 'eventId') = ${eventId}`,
                    sql`${localEventOutbox.id} <> ${currentId}`,
                ),
            )
            .limit(1);

        return rows.length > 0;
    }

    private async markSent(id: string): Promise<void> {
        await this.databaseService.db
            .update(localEventOutbox)
            .set({
                state: "sent",
                updatedAt: new Date(),
            })
            .where(eq(localEventOutbox.id, id));
    }

    private async scheduleRetryOrDeadLetter(id: string, retryCount: number, reason: string): Promise<void> {
        const nextRetryCount = retryCount + 1;

        if (nextRetryCount >= this.maxRetries) {
            await this.markDeadLetter(id, nextRetryCount, reason);
            return;
        }

        const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, nextRetryCount - 1));
        const nextRetryAt = new Date(Date.now() + delayMs);

        await this.databaseService.db
            .update(localEventOutbox)
            .set({
                state: "pending",
                retryCount: nextRetryCount,
                nextRetryAt,
                updatedAt: new Date(),
            })
            .where(eq(localEventOutbox.id, id));

        this.logger.warn(`Outbox dispatch retry scheduled for '${id}': ${reason}`);
    }

    private async markDeadLetter(id: string, retryCount: number, reason: string): Promise<void> {
        await this.databaseService.db
            .update(localEventOutbox)
            .set({
                state: "dead_letter",
                retryCount,
                updatedAt: new Date(),
            })
            .where(eq(localEventOutbox.id, id));

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
