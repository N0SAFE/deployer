import { Injectable } from "@nestjs/common";
import { DatabaseService } from "@/core/modules/database/services/database.service";
import { apiKeys } from "@/config/drizzle/schema/deployment";
import { eq, and } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

type ApiKeyRow = typeof apiKeys.$inferSelect;

export interface ApiKeyCreateInput {
    userId: string;
    name: string;
    keyHash: string;
    keyPreview: string;
    projectId?: string | null;
    scopes?: string[] | null;
    expiresAt?: Date | null;
}

@Injectable()
export class ApiKeyRepository {
    constructor(private readonly databaseService: DatabaseService) {}

    async findById(id: string): Promise<ApiKeyRow | null> {
        const db = this.databaseService.db;
        const results = await db
            .select()
            .from(apiKeys)
            .where(eq(apiKeys.id, id))
            .limit(1);
        return results[0] ?? null;
    }

    async findByHash(keyHash: string): Promise<ApiKeyRow | null> {
        const db = this.databaseService.db;
        const results = await db
            .select()
            .from(apiKeys)
            .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)))
            .limit(1);
        return results[0] ?? null;
    }

    async findByUser(userId: string): Promise<ApiKeyRow[]> {
        const db = this.databaseService.db;
        return db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
    }

    async findByProject(projectId: string): Promise<ApiKeyRow[]> {
        const db = this.databaseService.db;
        return db.select().from(apiKeys).where(eq(apiKeys.projectId, projectId));
    }

    async create(input: ApiKeyCreateInput): Promise<ApiKeyRow> {
        const db = this.databaseService.db;
        const results = await db.insert(apiKeys).values(input).returning();
        if (!results[0]) throw new Error("Failed to create API key");
        return results[0];
    }

    async setActive(id: string, isActive: boolean): Promise<ApiKeyRow | null> {
        const db = this.databaseService.db;
        const results = await db
            .update(apiKeys)
            .set({ isActive, updatedAt: new Date() })
            .where(eq(apiKeys.id, id))
            .returning();
        return results[0] ?? null;
    }

    async touchLastUsed(id: string): Promise<void> {
        const db = this.databaseService.db;
        await db
            .update(apiKeys)
            .set({ lastUsed: new Date() })
            .where(eq(apiKeys.id, id));
    }

    async delete(id: string): Promise<void> {
        const db = this.databaseService.db;
        await db.delete(apiKeys).where(eq(apiKeys.id, id));
    }
}
