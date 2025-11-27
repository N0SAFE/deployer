import { Injectable } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { services, deployments } from '@/config/drizzle/schema';

@Injectable()
export class StaticProviderRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Find deployment by ID with service ID
   */
  async findDeploymentWithServiceId(deploymentId: string) {
    const db = this.databaseService.db;
    const [row] = await db
      .select({ 
        id: deployments.id, 
        serviceId: deployments.serviceId 
      })
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1);
    
    return row || null;
  }

  /**
   * Get service with latest successful deployment
   */
  async findServiceWithLatestDeployment(serviceId: string) {
    const db = this.databaseService.db;
    const result = await db
      .select({
        service: services,
        latestDeployment: {
          id: deployments.id,
          status: deployments.status,
          deployCompletedAt: deployments.deployCompletedAt,
        },
      })
      .from(services)
      .leftJoin(deployments, eq(services.id, deployments.serviceId))
      .where(and(eq(services.id, serviceId), eq(deployments.status, 'success')))
      .orderBy(desc(deployments.deployCompletedAt))
      .limit(1);
    
    if (!result.length) {
      return null;
    }
    
    return {
      ...result[0].service,
      latestDeployment: result[0].latestDeployment,
    };
  }
}
