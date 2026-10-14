import { Injectable } from '@nestjs/common';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as localSchema from '@deployer/nest-schema/local';
import { BaseDatabaseService } from "@deployer/nest-database-core/base-database.service";

export type LocalDatabase = BunSQLiteDatabase<typeof localSchema>;

@Injectable()
export class LocalDatabaseService extends BaseDatabaseService<LocalDatabase> {}