import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DatabaseService } from '@/core/modules/database/services/database.service';

@Injectable()
@Command({ 
  name: 'migrate', 
  description: 'Run database migrations',
})
export class MigrateCommand extends CommandRunner {
  constructor(
    private readonly databaseService: DatabaseService,
  ) {
    super();
  }

  async run(): Promise<void> {
    console.log('🔄 Running database migrations...');

    try {
      await migrate(this.databaseService.db, { 
        migrationsFolder: './src/config/drizzle/migrations',
      });
      
      console.log('✅ Database migrations completed successfully');
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }
}