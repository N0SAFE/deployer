import { Injectable } from '@nestjs/common';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as localSchema from '@/config/drizzle/local/schema';
import { BaseDatabaseService } from '../shared/database.service';

export type LocalDatabase = BunSQLiteDatabase<typeof localSchema>;

@Injectable()
export class LocalDatabaseService extends BaseDatabaseService<LocalDatabase> {}