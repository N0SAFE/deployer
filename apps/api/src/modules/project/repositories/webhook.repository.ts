import { Injectable } from "@nestjs/common";
import { ConflictError } from "@repo/errors";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { webhooks } from "@/config/drizzle/global/schema/deployment";
import { eq, and } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

type WebhookRow = typeof webhooks.$inferSelect;

export type WebhookCreateInput = Pick<
    WebhookRow,
    "projectId" | "sourceType" | "webhookUrl" | "secret"
> & {
    serviceId?: string | null;
    externalWebhookId?: string | null;
    settings?: WebhookRow["settings"];
};

export type WebhookUpdateInput = Partial<
    Pick<WebhookRow, "webhookUrl" | "externalWebhookId" | "settings" | "isActive">
>;

@Injectable()
export class WebhookRepository {
    constructor(private readonly databaseService: GlobalDatabaseService) {}

    async findById(id: string): Promise<WebhookRow | null> {
        const db = this.databaseService.db;
        const results = await db
            .select()
            .from(webhooks)
            .where(eq(webhooks.id, id))
            .limit(1);
        return results[0] ?? null;
    }

    async findByProject(projectId: string): Promise<WebhookRow[]> {
        const db = this.databaseService.db;
        return db
            .select()
            .from(webhooks)
            .where(eq(webhooks.projectId, projectId));
    }

    async create(input: WebhookCreateInput): Promise<WebhookRow> {
        const db = this.databaseService.db;
        const results = await db
            .insert(webhooks)
            .values(input)
            .returning();
        if (!results[0]) throw new ConflictError("Failed to create webhook");
        return results[0];
    }

    async update(id: string, input: WebhookUpdateInput): Promise<WebhookRow | null> {
        const db = this.databaseService.db;
        const results = await db
            .update(webhooks)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(webhooks.id, id))
            .returning();
        return results[0] ?? null;
    }

    async updateSecret(id: string, secret: string): Promise<WebhookRow | null> {
        const db = this.databaseService.db;
        const results = await db
            .update(webhooks)
            .set({ secret, updatedAt: new Date() })
            .where(eq(webhooks.id, id))
            .returning();
        return results[0] ?? null;
    }

    async incrementTriggerCount(id: string): Promise<void> {
        const db = this.databaseService.db;
        await db
            .update(webhooks)
            .set({ lastTriggered: new Date(), updatedAt: new Date() })
            .where(and(eq(webhooks.id, id), eq(webhooks.isActive, true)));
    }

    async delete(id: string): Promise<void> {
        const db = this.databaseService.db;
        await db.delete(webhooks).where(eq(webhooks.id, id));
    }
}
