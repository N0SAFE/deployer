import { Injectable, Logger } from "@nestjs/common";
import { LocalDatabaseService } from "@/core/modules/database/services/local-database.service";
import { nodeMeshConfig } from "@/config/drizzle/local/schema";

export type NodeMeshConfigRow = typeof nodeMeshConfig.$inferSelect;

@Injectable()
export class NodeMeshConfigRepository {
    private readonly logger = new Logger(NodeMeshConfigRepository.name);

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

    /**
     * Returns the row after insert, OR `null` if the local
     * `node_mesh_config` table hasn't been migrated yet. Callers must
     * handle the `null` case by using in-memory defaults — see
     * `SystemMeshConfigService.ensureMeshConfig()` for the fallback.
     */
    upsert(data: Omit<typeof nodeMeshConfig.$inferInsert, "id">): NodeMeshConfigRow | null {
        const now = new Date().toISOString();
        try {
            this.localDb.db
                .insert(nodeMeshConfig)
                .values({ id: 1, ...data, updatedAt: now })
                .onConflictDoUpdate({
                    target: nodeMeshConfig.id,
                    set: { ...data, updatedAt: now },
                })
                .run();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("no such table: node_mesh_config")) {
                this.logger.warn(
                    "node_mesh_config table missing on local SQLite — local migrations probably did not run. " +
                        "Returning null so the caller can fall back to in-memory defaults.",
                );
                return null;
            }
            throw error;
        }
        return this.find();
    }
}
