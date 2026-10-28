import { BaseDatabaseService } from "../database/base-database.service";
import type { LocalDb } from "@deployer/node-state";
import { Injectable } from "@nestjs/common";

/** The typed Drizzle handle on the local SQLite database, for code that still queries it directly. */
@Injectable()
export class LocalDatabaseService extends BaseDatabaseService<LocalDb> {}
