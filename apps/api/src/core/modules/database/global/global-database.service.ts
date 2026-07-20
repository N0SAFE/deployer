import { Injectable, Logger } from '@nestjs/common';
import { BaseDatabaseService } from '../shared/database.service';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as globalSchema from '@/config/drizzle/global/schema';

export type GlobalDatabase = NodePgDatabase<typeof globalSchema>;

@Injectable()
export class GlobalDatabaseService extends BaseDatabaseService<GlobalDatabase> {
    private readonly logger = new Logger(GlobalDatabaseService.name);

    /**
     * Initialize the database connection with the given URL.
     * Creates a pg.Pool and a Drizzle instance, then sets the internal db handle.
     * Safe to call multiple times — re-initializes if already set.
     */
    async initialize(databaseUrl: string): Promise<void> {
        this.logger.log('📦 Initializing global database pool…');
        const pool = new Pool({ connectionString: databaseUrl });
        const db = drizzle(pool, { schema: globalSchema }) as unknown as GlobalDatabase;
        this.init(db);
        this.logger.log('✅ Global database initialized');
    }
}
