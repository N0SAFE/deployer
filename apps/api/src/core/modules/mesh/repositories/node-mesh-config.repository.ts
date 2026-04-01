import { Injectable } from "@nestjs/common";
import { LocalDatabaseService } from "@/core/modules/database/services/local-database.service";
import { nodeMeshConfig } from "@/config/drizzle/local/schema";

export type NodeMeshConfigRow = typeof nodeMeshConfig.$inferSelect;

@Injectable()
export class NodeMeshConfigRepository {
    constructor(private readonly localDb: LocalDatabaseService) {}

    find(): NodeMeshConfigRow | null {
        try {
            const rows = this.localDb.db.select().from(nodeMeshConfig).limit(1).all();
            return rows[0] ?? null;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("no such table: node_mesh_config")) {
                return null;
            }
            throw error;
        }
    }

    upsert(data: Omit<typeof nodeMeshConfig.$inferInsert, "id">): NodeMeshConfigRow {
        const now = new Date().toISOString();
        this.localDb.db
            .insert(nodeMeshConfig)
            .values({ id: 1, ...data, updatedAt: now })
            .onConflictDoUpdate({
                target: nodeMeshConfig.id,
                set: { ...data, updatedAt: now },
            })
            .run();
        const row = this.find();
        if (!row) {
            throw new Error("NodeMeshConfig upsert succeeded but row was not found");
        }
        return row;
    }
}
