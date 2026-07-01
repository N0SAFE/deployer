import { Injectable } from "@nestjs/common";
import { nodeConfig } from "@/config/drizzle/local/schema";
import { LocalDatabaseService } from "../../database/local/local-database.service";


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

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
        // Allow empty meshUrlsSnapshot for initial setup (e2e tests, fresh installs)
        const effectiveData = data.meshUrlsSnapshot?.length === 0
            ? { ...data, meshUrlsSnapshot: [] }
            : data;

        const now = new Date().toISOString();
        this.localDb.db
            .insert(nodeConfig)
            .values({ id: 1, ...effectiveData, updatedAt: now })
            .onConflictDoUpdate({
                target: nodeConfig.id,
                set: { ...effectiveData, updatedAt: now },
            })
            .run();
        const row = this.find();
        if (!row) {
            throw new Error("NodeConfig upsert succeeded but row was not found");
        }
        return row;
    }

    /**
     * Retrieve the mesh shared secret from the local node_config table.
     * Returns null if the row doesn't exist or the column is null.
     *
     * This is used by `resolveSharedSecret()` in the ORPC middleware layer
     * to dynamically provide the secret without relying on env vars.
     */
    getMeshSharedSecret(): string | null {
        const row = this.find();
        if (!row) return null;
        return Reflect.get(isRecord(row) ? row : {}, "meshSharedSecret") as string | null
            ?? Reflect.get(isRecord(row) ? row : {}, "mesh_shared_secret") as string | null
            ?? null;
    }
}
