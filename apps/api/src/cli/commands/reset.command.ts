import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';

@Injectable()
@Command({ 
  name: 'reset', 
  description: 'Reset the database by dropping and recreating the public schema',
})
export class ResetCommand extends CommandRunner {
  constructor(
    private readonly databaseService: DatabaseService,
  ) {
    super();
  }

  async run(): Promise<void> {
    console.log('🔄 Resetting database...');

    try {
      // Drop all tables
      await this.databaseService.db.execute(sql`DROP SCHEMA public CASCADE`);
      await this.databaseService.db.execute(sql`CREATE SCHEMA public`);
      await this.databaseService.db.execute(sql`GRANT ALL ON SCHEMA public TO postgres`);
      await this.databaseService.db.execute(sql`GRANT ALL ON SCHEMA public TO public`);
      
      console.log('✅ Database reset completed');
    } catch (error) {
      console.error('❌ Reset failed:', error);
      throw error;
    }
  }
}