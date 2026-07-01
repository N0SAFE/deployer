import { Command, CommandRunner } from 'nest-commander'
import { Injectable, Logger } from '@nestjs/common'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'
import { fileURLToPath } from 'url'
import { LocalDatabaseService } from '@/core/modules/database/local/local-database.service';
import { GlobalDatabaseService } from '@/core/modules/database/global/global-database.service';

/*
 * ─── Exit codes ──────────────────────────────────────────────────────────────
 *
 *  0  Success (all migrations applied)
 *  1  Local SQLite migration check failed
 *  2  Global Postgres migration failed
 */

@Injectable()
@Command({
    name: 'migrate',
    description: 'Run database migrations (SQLite + Postgres)',
})
export class MigrateCommand extends CommandRunner {
    private readonly logger = new Logger(MigrateCommand.name);

    constructor(
        private readonly localDatabaseService: LocalDatabaseService,
        private readonly globalDatabaseService: GlobalDatabaseService,
    ) {
        super();
    }

    async run(): Promise<void> {
        // ── Phase 1: Local (SQLite) verification ─────────────────────────────
        // SQLite tables are created by LocalModule's factory via
        // runSqliteMigrations() during module initialization. Here we just
        // verify the result for observability.
        this.logger.log(`🚀 Verifying local (SQLite) database...`);
        try {
            const localTableCount = this.localDatabaseService.db
                .all("SELECT name FROM sqlite_master WHERE type='table'")
                .length;
            this.logger.log(`✅ SQLite database: ${localTableCount} tables present (migrated by LocalModule)`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`❌ Local SQLite check failed: ${message}`);
            process.exit(1);
        }

        // ── Phase 2: Global (Postgres) connectivity ─────────────────────────
        this.logger.log(`🚀 Checking global (Postgres) database connectivity...`);
        try {
            await this.globalDatabaseService.db.execute(sql`SELECT 1`);
            this.logger.log(`✅ Postgres connection verified`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`❌ Cannot reach global Postgres: ${message}`);
            process.exit(2);
        }

        // ── Phase 3: Apply migrations ──────────────────────────────────────
        this.logger.log(`🚀 Running global (Postgres) database migrations...`);
        const migrationsFolder = fileURLToPath(
            new URL("../../config/drizzle/global/migrations", import.meta.url),
        );

        try {
            await migratePg(this.globalDatabaseService.db, { migrationsFolder });
            this.logger.log(`✅ Postgres database migrations completed successfully`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            // Distinguish common failure modes for clearer diagnostics
            if (message.includes('ECONNREFUSED')) {
                this.logger.error(`❌ Postgres connection lost during migration: ${message}`);
            } else if (message.includes('migration')) {
                this.logger.error(`❌ Migration file error: ${message}`);
            } else if (message.includes('duplicate') || message.includes('already exists')) {
                this.logger.warn(`⚠️  Migration reports duplicate objects — this may indicate a partial previous apply: ${message}`);
            } else {
                this.logger.error(`❌ Postgres migration failed: ${message}`);
            }

            process.exit(2);
        }

        return Promise.resolve();
    }
}
