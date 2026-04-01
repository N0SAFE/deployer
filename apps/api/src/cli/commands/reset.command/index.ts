import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject, Injectable } from '@nestjs/common';
import { GLOBAL_DATABASE_CONNECTION, LOCAL_DATABASE_CONNECTION } from '@/core/modules/database/database-connection';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as schema from '@/config/drizzle/global/schema';
import type * as localSchema from '@/config/drizzle/local/schema';
import { resetGlobal } from './global';
import { resetLocal } from './local';

type ResetTarget = 'global' | 'local' | 'both';

@Injectable()
@Command({ 
  name: 'reset', 
  description: 'Reset the database by dropping and recreating the public schema',
})
export class ResetCommand extends CommandRunner {
  private target: ResetTarget = 'both';

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
    description: 'Reset target: global | local | both',
  })
  parseTarget(value: string): ResetTarget {
    const normalized = value.toLowerCase();
    if (normalized === 'global' || normalized === 'local' || normalized === 'both') {
      return normalized;
    }
    throw new Error(`Invalid target: ${value}. Use global, local, or both.`);
  }

  async run(): Promise<void> {
    console.log(`🔄 Resetting database (target: ${this.target})...`);

    try {
      if (this.target === 'global' || this.target === 'both') {
        await resetGlobal(this.globalDb);
      }

      if (this.target === 'local' || this.target === 'both') {
        resetLocal(this.localDb);
      }
      
      console.log(`✅ Finished reset operation (target: ${this.target})`);
    } catch (error) {
      console.error('❌ Reset failed:', error);
      throw error;
    }
  }

  override setOptions(options: Record<string, string | boolean | string[]>): void {
    const optionValue = options.target;
    if (typeof optionValue === 'string') {
      this.target = this.parseTarget(optionValue);
    }
  }
}
