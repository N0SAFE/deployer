import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@/config/drizzle/global/schema';

export async function resetGlobal(globalDb: NodePgDatabase<typeof schema> | null): Promise<void> {
  if (!globalDb) {
    throw new Error('Global database connection is not configured. Cannot reset global database.');
  }

  await globalDb.execute(sql`DROP SCHEMA public CASCADE`);
  await globalDb.execute(sql`CREATE SCHEMA public`);
  await globalDb.execute(sql`GRANT ALL ON SCHEMA public TO postgres`);
  await globalDb.execute(sql`GRANT ALL ON SCHEMA public TO public`);
  
  console.log('✅ Global database reset completed');
}
