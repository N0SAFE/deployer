import { Injectable } from "@nestjs/common";
import { and, asc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { localEventOutbox } from "@/config/drizzle/global/schema/runtime";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";

type OutboxRow = typeof localEventOutbox.$inferSelect;
type OutboxState = OutboxRow["state"];

/**
 * LocalEventOutboxRepository — the single data-access layer for the
 * transactional outbox table. Extracted from LocalEventOutboxDispatcherService
 * and DeploymentReadModelProjectorService, which were reaching into the DB
 * directly (violating the service → repository layering).
 */
@Injectable()
export class LocalEventOutboxRepository {
    constructor(private readonly databaseService: GlobalDatabaseService) {}

    private get db() {
        return this.databaseService.db;
    }

    /** Insert a new pending outbox item. */
    async enqueue(input: {
        topic: string;
        payload: Record<string, unknown>;
        nodeId: string;
    }): Promise<void> {
        const now = new Date();
        await this.db.insert(localEventOutbox).values({
            id: randomUUID(),
            nodeId: input.nodeId,
            topic: input.topic,
            payload: input.payload,
            state: "pending",
            retryCount: 0,
            nextRetryAt: now,
            createdAt: now,
            updatedAt: now,
        });
    }

    /** Load due pending items (state=pending, nextRetryAt <= now). */
    async findDue(limit: number): Promise<OutboxRow[]> {
        const now = new Date();
        return this.db
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
    }

    /** Load a single outbox item by id. */
    async findById(id: string): Promise<OutboxRow | null> {
        const [row] = await this.db
            .select()
            .from(localEventOutbox)
            .where(eq(localEventOutbox.id, id))
            .limit(1);
        return row ?? null;
    }

    /** Load outbox items for a topic, optionally after a createdAt cursor. */
    async findByTopic(
        topic: string,
        options: { states?: readonly OutboxState[]; afterCreatedAt?: Date | null; limit: number },
    ): Promise<OutboxRow[]> {
        const conditions = [eq(localEventOutbox.topic, topic)];
        if (options.states && options.states.length > 0) {
            conditions.push(inArray(localEventOutbox.state, [...options.states]));
        }
        if (options.afterCreatedAt) {
            conditions.push(gt(localEventOutbox.createdAt, options.afterCreatedAt));
        }
        return this.db
            .select()
            .from(localEventOutbox)
            .where(and(...conditions))
            .orderBy(asc(localEventOutbox.createdAt), asc(localEventOutbox.id))
            .limit(options.limit);
    }

    /** Check whether a sent item with the same eventId already exists (dedupe). */
    async hasSentDuplicateEventId(currentId: string, eventId: string): Promise<boolean> {
        const rows = await this.db
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

    /** Mark an item as sent. */
    async markSent(id: string): Promise<void> {
        await this.db
            .update(localEventOutbox)
            .set({ state: "sent", updatedAt: new Date() })
            .where(eq(localEventOutbox.id, id));
    }

    /** Schedule a retry (or keep pending) with an exponential backoff. */
    async scheduleRetry(id: string, retryCount: number, maxRetries: number): Promise<"retry" | "dead_letter"> {
        const nextRetryCount = retryCount + 1;
        if (nextRetryCount >= maxRetries) {
            await this.markDeadLetter(id, nextRetryCount);
            return "dead_letter";
        }
        const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, nextRetryCount - 1));
        const nextRetryAt = new Date(Date.now() + delayMs);
        await this.db
            .update(localEventOutbox)
            .set({
                state: "pending",
                retryCount: nextRetryCount,
                nextRetryAt,
                updatedAt: new Date(),
            })
            .where(eq(localEventOutbox.id, id));
        return "retry";
    }

    /** Move an item to the dead-letter state. */
    async markDeadLetter(id: string, retryCount: number): Promise<void> {
        await this.db
            .update(localEventOutbox)
            .set({ state: "dead_letter", retryCount, updatedAt: new Date() })
            .where(eq(localEventOutbox.id, id));
    }
}