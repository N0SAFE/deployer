import { Logger } from '@nestjs/common';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as localSchema from '@/config/drizzle/local/schema';

export function resetLocal(localDb: BunSQLiteDatabase<typeof localSchema>): void {
  const logger = new Logger('resetLocal');
  localDb.run('DROP TABLE IF EXISTS node_mesh_config');
  localDb.run('DROP TABLE IF EXISTS node_config');
  localDb.run('DROP TABLE IF EXISTS __drizzle_migrations');
  logger.log('✅ Local database reset completed');
}
