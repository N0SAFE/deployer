import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { listBuilder } from "@/core/utils/drizzle-filter.utils";
import { coreEventStreams } from "@/config/drizzle/global/schema/events";
import type { CoreEventStreamListInput } from "@repo/api-contracts";
import { coreEventStreamDefinitionSchema, type CoreEventStreamDefinition } from "@repo/contracts-entities";

type CoreEventStreamRow = typeof coreEventStreams.$inferSelect;

function toDto(row: CoreEventStreamRow): CoreEventStreamDefinition {
    return coreEventStreamDefinitionSchema.parse({
        ...row,
        description: row.description ?? null,
        scopeId: row.scopeId ?? null,
        filters: row.filters ?? null,
        createdBy: row.createdBy ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    });
}

@Injectable()
export class CoreEventStreamRepository {
    constructor(private readonly databaseService: GlobalDatabaseService) {}

    async findMany(input: CoreEventStreamListInput | undefined): Promise<{
        data: CoreEventStreamDefinition[];
        meta: {
            total: number;
            limit: number;
            offset: number;
            hasMore: boolean;
        };
    }> {
        const db = this.databaseService.db;
        const filter = input?.filter ?? {};
        const sort = input?.sortBy ?? "createdAt";
        const direction = input?.sortDirection ?? "desc";

        const result = await listBuilder(filter)
            .filter({
                name: (entry) => {
                    switch (entry.operator) {
                        case "eq":
                            return entry.common.eq(coreEventStreams.name);
                        case "like":
                            return entry.common.like(coreEventStreams.name);
                        case "ilike":
                            return entry.common.ilike(coreEventStreams.name);
                    }
                },
                namespace: (entry) => {
                    switch (entry.operator) {
                        case "eq":
                            return entry.common.eq(coreEventStreams.namespace);
                        case "like":
                            return entry.common.like(coreEventStreams.namespace);
                        case "ilike":
                            return entry.common.ilike(coreEventStreams.namespace);
                    }
                },
                isActive: (entry) => entry.common.eq(coreEventStreams.isActive),
                scope: (entry) => entry.common.eq(coreEventStreams.scope),
                scopeId: (entry) => entry.common.eq(coreEventStreams.scopeId),
                createdBy: (entry) => entry.common.eq(coreEventStreams.createdBy),
            })
            .order(
                sort,
                direction,
                {
                    createdAt: coreEventStreams.createdAt,
                    updatedAt: coreEventStreams.updatedAt,
                    name: coreEventStreams.name,
                    namespace: coreEventStreams.namespace,
                },
                coreEventStreams.createdAt,
            )
            .pagination({ limit: input?.limit ?? 20, offset: input?.offset ?? 0 })
            .execute(db, coreEventStreams);

        return {
            data: result.data.map(toDto),
            meta: result.meta,
        };
    }

    async findById(id: string): Promise<CoreEventStreamDefinition | null> {
        const db = this.databaseService.db;
        const [row] = await db
            .select()
            .from(coreEventStreams)
            .where(eq(coreEventStreams.id, id))
            .limit(1);

        return row ? toDto(row) : null;
    }

}
