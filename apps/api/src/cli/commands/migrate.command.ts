import { Command, CommandRunner } from 'nest-commander'
import { Injectable } from '@nestjs/common'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'url'
import { LocalDatabaseService } from '@/core/modules/database/local/local-database.service';
import { GlobalDatabaseService } from '@/core/modules/database/global/global-database.service';

@Injectable()
@Command({
    name: 'migrate',
    description: 'Run database migrations (SQLite + Postgres)',
})
export class MigrateCommand extends CommandRunner {
    constructor(
        private readonly localDatabaseService: LocalDatabaseService,
        private readonly globalDatabaseService: GlobalDatabaseService,
    ) {
        super()
    }

    async run(): Promise<void> {
        // ── Local (SQLite) migrations ────────────────────────────────────────
        // Already applied by LocalModule's factory via runSqliteMigrations().
        // We verify here for Docker orchestration.
        console.log(`🚀 Checking local (SQLite) database migrations...`)
        const localTableCount = this.localDatabaseService.db
            .all("SELECT name FROM sqlite_master WHERE type='table'")
            .length
        console.log(`✅ SQLite database: ${localTableCount} tables present (migrated by LocalModule)`)

        // ── Global (Postgres) migrations ─────────────────────────────────────
        console.log(`🚀 Running global (Postgres) database migrations...`)
        const migrationsFolder = fileURLToPath(
            new URL("../../config/drizzle/global/migrations", import.meta.url),
        )
        try {
            await migratePg(this.globalDatabaseService.db, { migrationsFolder })
            console.log(`✅ Postgres database migrations completed successfully`)
        } catch (error) {
            console.error('❌ Postgres migration failed:', error)
            throw error
        }

        return Promise.resolve()
    }
}
