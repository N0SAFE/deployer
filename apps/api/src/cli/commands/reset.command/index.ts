import { Command, CommandRunner } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { resetLocal } from './local';
import { LocalDatabaseService } from '@/core/modules/database/local/local-database.service';

@Injectable()
@Command({ 
  name: 'reset', 
  description: 'Reset the database by dropping and recreating the public schema',
})
export class ResetCommand extends CommandRunner {

  constructor(
    private readonly localDatabaseService: LocalDatabaseService,
  ) {
    super();
  }

  run() {
    try {
      resetLocal(this.localDatabaseService.db);
      
      this.logger.log(`✅ Finished reset operation`);
    } catch (error) {
      this.logger.error('❌ Reset failed:', error);
      throw error;
    }
    return Promise.resolve();
  }
}
