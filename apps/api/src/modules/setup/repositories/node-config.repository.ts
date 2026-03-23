import { Injectable } from "@nestjs/common";
import { LocalDatabaseService } from "@/core/modules/local-database/local-database.service";
import { nodeConfig } from "@/config/drizzle/local-schema";

export type NodeConfigRow = typeof nodeConfig.$inferSelect;

@Injectable()
export class NodeConfigRepository {
    constructor(private readonly localDb: LocalDatabaseService) {}

    find(): NodeConfigRow | null {
        try {
            const rows = this.localDb.db.select().from(nodeConfig).limit(1).all();
            return rows[0] ?? null;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("no such table: node_config")) {
                return null;
            }
            throw error;
        }
    }

    upsert(data: Omit<typeof nodeConfig.$inferInsert, "id">): NodeConfigRow {
        const now = new Date().toISOString();
        this.localDb.db
            .insert(nodeConfig)
            .values({ id: 1, ...data, updatedAt: now })
            .onConflictDoUpdate({
                target: nodeConfig.id,
                set: { ...data, updatedAt: now },
            })
            .run();
        const row = this.find();
        if (!row) {
            throw new Error("NodeConfig upsert succeeded but row was not found");
        }
        return row;
    }
}
