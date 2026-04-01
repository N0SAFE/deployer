import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { coreEventLogs } from "@/config/drizzle/global/schema/events";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";

export interface CoreEventLogPersistInput {
    namespace: string;
    eventName: string;
    eventKey: string;
    sequence: number;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    emittedAt: Date;
}

export interface CoreEventLogRecord {
    namespace: string;
    eventName: string;
    eventKey: string;
    sequence: number;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    emittedAt: Date;
}

@Injectable()
export class CoreEventLogRepository {
    constructor(private readonly databaseService: GlobalDatabaseService) {}

    async insertMany(logs: CoreEventLogPersistInput[]): Promise<void> {
        if (logs.length === 0) {
            return;
        }

        await this.databaseService.db.insert(coreEventLogs).values(
            logs.map((log) => ({
                namespace: log.namespace,
                eventName: log.eventName,
                eventKey: log.eventKey,
                sequence: log.sequence,
                input: log.input,
                output: log.output,
                emittedAt: log.emittedAt,
                createdAt: new Date(),
            })),
        );
    }

    async findRecentByEventKey(input: {
        namespace: string;
        eventName: string;
        eventKey: string;
        limit: number;
    }): Promise<CoreEventLogRecord[]> {
        const rows = await this.databaseService.db
            .select()
            .from(coreEventLogs)
            .where(
                and(
                    eq(coreEventLogs.namespace, input.namespace),
                    eq(coreEventLogs.eventName, input.eventName),
                    eq(coreEventLogs.eventKey, input.eventKey),
                ),
            )
            .orderBy(desc(coreEventLogs.emittedAt), desc(coreEventLogs.sequence))
            .limit(input.limit);

        return rows
            .map((row) => ({
                namespace: row.namespace,
                eventName: row.eventName,
                eventKey: row.eventKey,
                sequence: row.sequence,
                input: row.input,
                output: row.output,
                emittedAt: row.emittedAt,
            }))
            .reverse();
    }

    async findRecentByEventName(input: {
        namespace: string;
        eventName: string;
        limit: number;
    }): Promise<CoreEventLogRecord[]> {
        const rows = await this.databaseService.db
            .select()
            .from(coreEventLogs)
            .where(
                and(
                    eq(coreEventLogs.namespace, input.namespace),
                    eq(coreEventLogs.eventName, input.eventName),
                ),
            )
            .orderBy(desc(coreEventLogs.emittedAt), desc(coreEventLogs.sequence))
            .limit(input.limit);

        return rows
            .map((row) => ({
                namespace: row.namespace,
                eventName: row.eventName,
                eventKey: row.eventKey,
                sequence: row.sequence,
                input: row.input,
                output: row.output,
                emittedAt: row.emittedAt,
            }))
            .reverse();
    }
}
