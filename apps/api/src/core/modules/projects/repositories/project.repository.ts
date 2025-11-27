import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { projects } from '@/config/drizzle/schema';

@Injectable()
export class ProjectRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Find project by ID
   */
  async findById(id: string) {
    const db = this.databaseService.db;
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    
    return project || null;
  }

  /**
   * Find project by name
   */
  async findByName(name: string) {
    const db = this.databaseService.db;
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.name, name))
      .limit(1);
    
    return project || null;
  }
}
