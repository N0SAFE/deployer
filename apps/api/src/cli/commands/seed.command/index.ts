import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject, Injectable } from '@nestjs/common';
import { GlobalDatabaseService } from '@/core/modules/database/services/global-database.service';
import { LocalDatabaseService } from '@/core/modules/database/services/local-database.service';
import { DATABASE_SERVICE, AUTH_CORE_SERVICE, CLI_AUTH_SERVICE_TOKEN } from '../../tokens';
import { CliAuthService } from '../../services/cli-auth.service';
import { AuthCoreService } from '@/core/modules/auth/services/auth-core.service';
import { seedGlobal } from './global';
import { seedLocal } from './local';

type SeedTarget = 'global' | 'local' | 'both';

@Command({
  name: "seed",
  description: "Seed the database with initial data",
})
@Injectable()
export class SeedCommand extends CommandRunner {
  private target: SeedTarget = 'both';

  @Option({
    flags: '-t, --target <target>',
    description: 'Seed target: global | local | both',
  })
  parseTarget(value: string): SeedTarget {
    const normalized = value.toLowerCase();
    if (normalized === 'global' || normalized === 'local' || normalized === 'both') {
      return normalized as SeedTarget;
    }
    throw new Error(`Invalid target: ${value}. Use global, local, or both.`);
  }

  setOptions(options: Record<string, string | boolean | string[]>): void {
    const optionValue = options.target;
    if (typeof optionValue === 'string') {
      this.target = this.parseTarget(optionValue);
    }
  }

  constructor(
    @Inject(DATABASE_SERVICE)
    private readonly databaseService: GlobalDatabaseService,
    private readonly localDb: LocalDatabaseService,
    @Inject(AUTH_CORE_SERVICE)
    private readonly authCoreService: AuthCoreService,
    @Inject(CLI_AUTH_SERVICE_TOKEN)
    private readonly cliAuthService: CliAuthService,
  ) {
    super();
  }

  async run(): Promise<void> {
    console.log(`🌱 Seeding database (target: ${this.target})...`);

    try {
      if (this.target === 'global' || this.target === 'both') {
        await seedGlobal(this.databaseService, this.authCoreService, this.cliAuthService);
      }
      
      if (this.target === 'local' || this.target === 'both') {
        await seedLocal(this.localDb);
      }
    } catch (error) {
      console.error("❌ Seeding failed:", error);
      throw error;
    }
  }
}
