import { Injectable, Logger } from "@nestjs/common";
import { Observable, firstValueFrom, lastValueFrom, toArray } from "rxjs";
import { SystemMeshResourceDiscoveryService } from "../services/system-mesh-resource-discovery/system-mesh-resource-discovery.service";
import type { MeshQueryBuilder } from "../services/system-mesh-resource-discovery/query/mesh-query-builder";
import type { MeshQueryResult } from "../services/system-mesh-resource-discovery/query/mesh-query-builder-types";
import { eq, and, gt, contains } from "../services/system-mesh-resource-discovery/query/mesh-where";
import { count, avg, groupBy } from "../services/system-mesh-resource-discovery/query/mesh-aggregate";
import { TestDeploymentMeshService, type Deployment } from "./test-deployment-mesh.service";

// ─── DTOs for consumer operations ─────────────────────────────────────────────

export interface DeploymentHealthReport {
  totalDeployments: number;
  healthyCount: number;
  unhealthyCount: number;
  byEnvironment: Record<string, { healthy: number; unhealthy: number }>;
  averageReplicas: number;
}

export interface ServiceDeploymentSummary {
  serviceId: string;
  deployments: readonly Deployment[];
  latestVersion: string | null;
  totalReplicas: number;
}

// ─── Consumer Service ─────────────────────────────────────────────────────────

/**
 * Example service demonstrating how to consume the mesh discovery system.
 *
 * This service uses SystemMeshResourceDiscoveryService to query deployment
 * data from across the entire mesh cluster in a type-safe manner.
 */
@Injectable()
export class TestDeploymentConsumerService {
  private readonly logger = new Logger(TestDeploymentConsumerService.name);

  constructor(
    private readonly discovery: SystemMeshResourceDiscoveryService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Basic Queries
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all running production deployments.
   */
  async getRunningProductionDeployments(): Promise<MeshQueryResult<Deployment>> {
    this.logger.log("Querying running production deployments...");

    return this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .where({
        environment: "prod",
        status: "running",
      })
      .orderBy("createdAt", "desc")
      .limit(100)
      .execute();
  }

  /**
   * Get deployments for a specific service with filtering.
   */
  async getServiceDeployments(
    serviceId: string,
    options?: { healthy?: boolean; environment?: "prod" | "staging" | "dev" }
  ): Promise<readonly Deployment[]> {
    this.logger.log(`Fetching deployments for service: ${serviceId}`);

    let builder = this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .where({ serviceId });

    if (options?.healthy !== undefined) {
      builder = builder.where({ healthy: options.healthy });
    }

    if (options?.environment) {
      builder = builder.where({ environment: options.environment });
    }

    const result = await builder.orderBy("updatedAt", "desc").execute();
    return result.items;
  }

  /**
   * Find a specific deployment by ID.
   */
  async findDeployment(deploymentId: string): Promise<Deployment | null> {
    const result = await this.discovery.query(
      TestDeploymentMeshService.queries.findDeploymentById,
      { deploymentId }
    );
    return result.items[0] ?? null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Advanced Queries with Functional Where
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get deployments with complex filtering using functional where expressions.
   */
  async getDeploymentsWithComplexFilter(): Promise<readonly Deployment[]> {
    this.logger.log("Querying deployments with complex filter...");

    const result = await this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .where(
        and<Deployment>(
          eq("environment", "prod"),
          eq("status", "running"),
          gt("replicas", 2)
        )
      )
      .execute();

    return result.items;
  }

  /**
   * Search deployments with text query and filters.
   */
  async searchDeployments(
    query: string,
    filters?: { environment?: "prod" | "staging" | "dev"; healthy?: boolean }
  ): Promise<readonly Deployment[]> {
    this.logger.log(`Searching deployments: "${query}"`);

    // For search queries with custom input schemas, use discovery.queryWithInput()
    // which passes the input directly to the query handler
    const result = await this.discovery.queryWithInput(
      TestDeploymentMeshService.queries.searchDeployments,
      {
        query,
        ...(filters && { filters }),
      }
    );

    return result.items;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Projections (Select)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get only specific fields from deployments — useful for large datasets.
   */
  async getDeploymentSummaries(): Promise<
    readonly Pick<Deployment, "deploymentId" | "serviceId" | "status" | "environment">[]
  > {
    this.logger.log("Fetching deployment summaries...");

    const result = await this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .select(["deploymentId", "serviceId", "status", "environment"])
      .limit(1000)
      .execute();

    return result.items;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Joins
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Example of joining deployments with their logs.
   * Note: This demonstrates the join API pattern.
   */
  async getDeploymentsWithRecentLogs(): Promise<
    { deployment: Deployment; recentLogs: readonly unknown[] }[]
  > {
    this.logger.log("Fetching deployments with recent logs...");

    // First, get deployments
    const deploymentsResult = await this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .where({ status: "running" })
      .limit(50)
      .execute();

    // Then fetch logs for each (in real usage, this would be a proper join)
    const withLogs = await Promise.all(
      deploymentsResult.items.map(async (deployment) => {
        const logsResult = await this.discovery
          .from(TestDeploymentMeshService.queries.deploymentLogs)
          .where({ deploymentId: deployment.deploymentId })
          .limit(10)
          .execute();

        return {
          deployment,
          recentLogs: logsResult.items,
        };
      })
    );

    return withLogs;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Aggregations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate a health report with aggregations.
   */
  async generateHealthReport(): Promise<DeploymentHealthReport> {
    this.logger.log("Generating deployment health report...");

    // Get all deployments
    const allDeployments = await this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .execute();

    const deployments = allDeployments.items;

    // Calculate aggregations manually (in real usage, would use aggregate API)
    const healthyCount = deployments.filter((d) => d.healthy).length;
    const unhealthyCount = deployments.length - healthyCount;

    const byEnvironment: DeploymentHealthReport["byEnvironment"] = {};
    for (const env of ["prod", "staging", "dev"] as const) {
      const envDeployments = deployments.filter((d) => d.environment === env);
      byEnvironment[env] = {
        healthy: envDeployments.filter((d) => d.healthy).length,
        unhealthy: envDeployments.filter((d) => !d.healthy).length,
      };
    }

    const totalReplicas = deployments.reduce((sum, d) => sum + d.replicas, 0);

    return {
      totalDeployments: deployments.length,
      healthyCount,
      unhealthyCount,
      byEnvironment,
      averageReplicas: deployments.length > 0 ? totalReplicas / deployments.length : 0,
    };
  }

  /**
   * Example of using the aggregate API (when fully implemented).
   */
  async getDeploymentStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    avgReplicas: number;
  }> {
    this.logger.log("Fetching deployment statistics...");

    // This demonstrates the intended aggregate API pattern
    // In a full implementation, this would be:
    /*
    return this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .aggregate({
        total: count(),
        byStatus: groupBy("status", count()),
        avgReplicas: avg("replicas"),
      })
      .execute();
    */

    // For now, calculate manually
    const result = await this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .execute();

    const deployments = result.items;
    const byStatus: Record<string, number> = {};

    for (const deployment of deployments) {
      byStatus[deployment.status] = (byStatus[deployment.status] ?? 0) + 1;
    }

    return {
      total: deployments.length,
      byStatus,
      avgReplicas: deployments.length > 0
        ? deployments.reduce((sum, d) => sum + d.replicas, 0) / deployments.length
        : 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Streaming
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Stream deployment updates in real-time.
   */
  streamDeploymentUpdates(): Observable<Deployment> {
    this.logger.log("Starting deployment update stream...");

    return this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .where({ status: "running" })
      .stream();
  }

  /**
   * Process deployments in batches using streaming.
   */
  async processDeploymentsInBatches(
    batchSize: number,
    processor: (batch: Deployment[]) => Promise<void>
  ): Promise<void> {
    this.logger.log(`Processing deployments in batches of ${batchSize}...`);

    const deployments = await firstValueFrom(
      this.streamDeploymentUpdates().pipe(toArray())
    );

    for (let i = 0; i < deployments.length; i += batchSize) {
      const batch = deployments.slice(i, i + batchSize);
      await processor(batch);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Scope and Strategy
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Query with specific execution scope.
   * Useful for controlling which nodes are queried.
   */
  async getDeploymentsWithScope(
    organizationId: string,
    strategy: "broadcast-merge" | "local-only" | "direct-node" = "broadcast-merge"
  ): Promise<readonly Deployment[]> {
    this.logger.log(`Querying deployments with strategy: ${strategy}`);

    const result = await this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .scope({
        organizationId,
        strategy,
        timeoutMs: 5000,
      })
      .where({ status: "running" })
      .execute();

    return result.items;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Query Introspection
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Explain a query to see what it will do without executing.
   */
  explainDeploymentQuery(): string {
    const builder = this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .where({ environment: "prod" })
      .where({ status: "running" })
      .orderBy("createdAt", "desc")
      .limit(100);

    return this.discovery.explainFormatted(builder);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Complex Examples
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get deployment summary grouped by service.
   */
  async getServiceSummaries(): Promise<ServiceDeploymentSummary[]> {
    this.logger.log("Fetching service deployment summaries...");

    const allDeployments = await this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .execute();

    // Group by serviceId
    const byService = new Map<string, Deployment[]>();
    for (const deployment of allDeployments.items) {
      const existing = byService.get(deployment.serviceId) ?? [];
      existing.push(deployment);
      byService.set(deployment.serviceId, existing);
    }

    // Build summaries
    const summaries: ServiceDeploymentSummary[] = [];
    for (const [serviceId, deployments] of byService) {
      const latestVersion = deployments
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]?.version ?? null;

      summaries.push({
        serviceId,
        deployments,
        latestVersion,
        totalReplicas: deployments.reduce((sum, d) => sum + d.replicas, 0),
      });
    }

    return summaries;
  }

  /**
   * Find unhealthy deployments that need attention.
   */
  async findUnhealthyDeployments(): Promise<
    { deployment: Deployment; issues: string[] }[]
  > {
    this.logger.log("Finding unhealthy deployments...");

    const result = await this.discovery
      .from(TestDeploymentMeshService.queries.deployments)
      .where({ healthy: false })
      .execute();

    return result.items.map((deployment) => ({
      deployment,
      issues: this.diagnoseDeployment(deployment),
    }));
  }

  private diagnoseDeployment(deployment: Deployment): string[] {
    const issues: string[] = [];

    if (!deployment.healthy) {
      issues.push("Deployment is unhealthy");
    }

    if (deployment.status === "failed") {
      issues.push("Deployment has failed status");
    }

    if (deployment.replicas === 0 && deployment.status === "running") {
      issues.push("Running deployment has zero replicas");
    }

    return issues;
  }
}
