import z from "zod/v4";

import { baseSupervisorPayloadSchema, baseSupervisorProcessInfoSchema, sqliteProcessInfoSchema } from "@deployer/supervision";

export const LOCAL_DB_SUPERVISOR_ID = "local-db-sqlite";

/** Rich health payload for the local SQLite database. */
export const localDbSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
	dbPath: z.string(),
	journalMode: z.string(),
	tableCount: z.number().int().min(0),
	tables: z.array(z.string()),
	migrationsApplied: z.number().int().min(0),
	fileSizeBytes: z.number().int().min(0).nullable(),
	databaseSizeBytes: z.number().int().min(0),
});
export type LocalDbSupervisorPayload = z.output<typeof localDbSupervisorPayloadSchema>;

/** Process info: the supervised process is the local sqlite file itself. */
export const localDbProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: sqliteProcessInfoSchema,
});
export type LocalDbProcessInfo = z.output<typeof localDbProcessInfoSchema>;
