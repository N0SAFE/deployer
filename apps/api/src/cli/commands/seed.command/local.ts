import { LocalDatabaseService } from '@/core/modules/database/services/local-database.service';

export async function seedLocal(localDb: LocalDatabaseService): Promise<void> {
  console.log('📦 Applying local seed...');
  // Currently nothing to seed locally
  console.log('✅ Local Database seeded successfully');
}
