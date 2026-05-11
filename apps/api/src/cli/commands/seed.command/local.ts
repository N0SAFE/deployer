import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as localSchema from '@/config/drizzle/local/schema';

export function seedLocal(_localDb: BunSQLiteDatabase<typeof localSchema>) {
  console.log('📦 Applying local seed...');
  // Currently nothing to seed locally
  console.log('✅ Local Database seeded successfully');
}
