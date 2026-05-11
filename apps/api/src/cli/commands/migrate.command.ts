import { Command, CommandRunner } from 'nest-commander'
import { Injectable } from '@nestjs/common'
import { migrate as migrateSqlLite } from 'drizzle-orm/bun-sqlite/migrator'
import { DATABASE_CONSTANTS } from '../../core/modules/database/database.constants'
import { LocalDatabaseService } from '@/core/modules/database/local/local-database.service';

@Injectable()
@Command({
    name: 'migrate',
    description: 'Run database migrations',
})
export class MigrateCommand extends CommandRunner {
    constructor(
        private readonly localDatabaseService: LocalDatabaseService
    ) {
        super()
    }

    async run(): Promise<void> {
        console.log(`🚀 Starting database migrations...`)
        const localMigrationsFolder = DATABASE_CONSTANTS.MIGRATIONS.LOCAL_FOLDER

        try {
            console.log(
                `🔄 Running LOCAL migrations from ${localMigrationsFolder}...`
            )
            migrateSqlLite(this.localDatabaseService.db, {
                migrationsFolder: localMigrationsFolder,
            })

            console.log(`✅ Database migrations completed successfully`)
        } catch (error) {
            console.error('❌ Migration failed:', error)
            throw error
        }
        return Promise.resolve()
    }
}
