import { Logger, Inject } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';

import { LocalDatabase, type LocalDatabaseShape } from "@deployer/node-state"

import { seedLocal } from './local';


@Command({
  name: "seed",
  description: "Seed the database with initial data",
})
export class SeedCommand extends CommandRunner {
  private readonly logger = new Logger(SeedCommand.name);
  constructor(
    @Inject(LocalDatabase) private readonly localDatabase: LocalDatabaseShape,
  ) {
    super();
  }

  async run(): Promise<void> {
    this.logger.log(`🌱 Seeding database...`);
    
    try {
      seedLocal(this.localDatabase.db);
    } catch (error) {
      this.logger.error("❌ Seeding failed:", error);
      throw error;
    }
    return Promise.resolve();
  }
}
