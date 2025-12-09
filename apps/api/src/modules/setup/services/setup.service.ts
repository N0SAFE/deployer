import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { user } from '@/config/drizzle/schema';

@Injectable()
export class SetupService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Check if initial setup is required
   * Returns true if no users exist in the database
   */
  async checkSetupStatus(): Promise<{ needsSetup: boolean; hasUsers: boolean }> {
    const users = await this.database.db
      .select({ id: user.id })
      .from(user)
      .limit(1);
    
    const hasUsers = users.length > 0;
    
    return {
      needsSetup: !hasUsers,
      hasUsers,
    };
  }

  /**
   * Verify that setup is still needed (no race conditions)
   */
  async verifySetupNeeded(): Promise<boolean> {
    const { needsSetup } = await this.checkSetupStatus();
    return needsSetup;
  }
}
