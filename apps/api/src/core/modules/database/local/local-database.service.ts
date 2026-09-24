import { Injectable } from '@nestjs/common';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as localSchema from '@repo/nest-schema/local';
import { BaseDatabaseService } from '../shared/database.service';

export type LocalDatabase = BunSQLiteDatabase<typeof localSchema>;

@Injectable()
export class LocalDatabaseService extends BaseDatabaseService<LocalDatabase> {}