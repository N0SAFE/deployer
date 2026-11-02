import { Logger } from '@nestjs/common';

import type * as localSchema from '@deployer/nest-schema/local';

import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

export function seedLocal(_localDb: BunSQLiteDatabase<typeof localSchema>) {
  const logger = new Logger('seedLocal');
  logger.log('📦 Applying local seed...');
  // Currently nothing to seed locally
  logger.log('✅ Local Database seeded successfully');
}
