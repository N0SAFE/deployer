import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject, Injectable } from '@nestjs/common';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migrateSqlLite } from 'drizzle-orm/bun-sqlite/migrator';
import { GLOBAL_DATABASE_CONNECTION, LOCAL_DATABASE_CONNECTION } from '../../core/modules/database/database-connection';
import { DATABASE_CONSTANTS } from '../../core/modules/database/database.constants';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as schema from '../../config/drizzle/global/schema';
import type * as localSchema from '../../config/drizzle/local/schema';

type MigrationTarget = 'global' | 'local' | 'both';

@Injectable()
@Command({ 
  name: 'migrate', 
  description: 'Run database migrations',
})
export class MigrateCommand extends CommandRunner {
  private target: MigrationTarget = 'both';

  constructor(
    @Inject(GLOBAL_DATABASE_CONNECTION)
    private readonly globalDb: NodePgDatabase<typeof schema> | null,
    @Inject(LOCAL_DATABASE_CONNECTION)
    private readonly localDb: BunSQLiteDatabase<typeof localSchema>,
  ) {
    super();
  }

  @Option({
    flags: '-t, --target <target>',
    description: 'Migration target: global | local | both',
  })
  parseTarget(value: string): MigrationTarget {
    const normalized = value.toLowerCase();
    if (normalized === 'global' || normalized === 'local' || normalized === 'both') {
      return normalized;
    }
    throw new Error(`Invalid target: ${value}. Use global, local, or both.`);
  }

  async run(): Promise<void> {
    const target = this.target;
    const globalMigrationsFolder = DATABASE_CONSTANTS.MIGRATIONS.GLOBAL_FOLDER;
    const localMigrationsFolder = DATABASE_CONSTANTS.MIGRATIONS.LOCAL_FOLDER;

    try {
      if (target === 'global' || target === 'both') {
        if (!this.globalDb) {
          throw new Error('Global database connection is not configured. Cannot run global migrations.');
        }

        console.log(`🔄 Running GLOBAL migrations from ${globalMigrationsFolder}...`);
        await migratePg(this.globalDb, {
          migrationsFolder: globalMigrationsFolder,
        });
      }

      if (target === 'local' || target === 'both') {
        console.log(`🔄 Running LOCAL migrations from ${localMigrationsFolder}...`);
        migrateSqlLite(this.localDb, {
          migrationsFolder: localMigrationsFolder,
        });
      }
      
      console.log(`✅ Database migrations completed successfully (target: ${target})`);
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  setOptions(options: Record<string, string | boolean | string[]>): void {
    const optionValue = options.target;
    if (typeof optionValue === 'string') {
      this.target = this.parseTarget(optionValue);
    }
  }
}