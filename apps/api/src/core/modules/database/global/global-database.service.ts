import { Injectable } from '@nestjs/common';
import { BaseDatabaseService } from '../shared/database.service';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as globalSchema from '@/config/drizzle/global/schema';

export type GlobalDatabase = NodePgDatabase<typeof globalSchema>;

@Injectable()
export class GlobalDatabaseService extends BaseDatabaseService<GlobalDatabase> {}
