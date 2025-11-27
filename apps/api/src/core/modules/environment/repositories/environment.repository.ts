import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { environments } from '@/config/drizzle/schema';

@Injectable()
export class EnvironmentRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Find environment by ID
   */
  async findById(id: string) {
    const db = this.databaseService.db;
    const [environment] = await db
      .select({ id: environments.id })
      .from(environments)
      .where(eq(environments.id, id))
      .limit(1);
    
    return environment || null;
  }

  /**
   * Find environment by slug
   */
  async findBySlug(slug: string, projectId?: string) {
    const db = this.databaseService.db;
    
    const conditions = [eq(environments.slug, slug)];
    if (projectId) {
      conditions.push(eq(environments.projectId, projectId));
    }
    
    const [environment] = await db
      .select({ id: environments.id })
      .from(environments)
      .where(and(...conditions))
      .limit(1);
    
    return environment || null;
  }
}
