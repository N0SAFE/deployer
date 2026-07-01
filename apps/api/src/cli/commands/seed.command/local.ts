import { Logger } from '@nestjs/common';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as localSchema from '@/config/drizzle/local/schema';

export function seedLocal(_localDb: BunSQLiteDatabase<typeof localSchema>) {
  const logger = new Logger('seedLocal');
  logger.log('📦 Applying local seed...');
  // Currently nothing to seed locally
  logger.log('✅ Local Database seeded successfully');
}
