import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { seedLocal } from './local';
import { LocalDatabaseService } from '@/core/modules/database/local/local-database.service';

@Command({
  name: "seed",
  description: "Seed the database with initial data",
})
@Injectable()
export class SeedCommand extends CommandRunner {
  constructor(
    private readonly localDatabaseService: LocalDatabaseService,
  ) {
    super();
  }

  async run(): Promise<void> {
    console.log(`🌱 Seeding database...`);
    
    try {
      seedLocal(this.localDatabaseService.db);
    } catch (error) {
      console.error("❌ Seeding failed:", error);
      throw error;
    }
    return Promise.resolve();
  }
}
