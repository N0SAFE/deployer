/**
 * Test Deployment Mesh - Usage Examples
 *
 * This file demonstrates comprehensive usage patterns for the mesh resource
 * discovery system with the test deployment service.
 *
 * Run with: `ts-node test-deployment-mesh.example.ts`
 * Or integrate into your test suite.
 */

import { TestDeploymentConsumerService } from "./test-deployment-consumer.service";
import { TestDeploymentMeshService } from "./test-deployment-mesh.service";

// ─── Type-safe Entity References ──────────────────────────────────────────────

/**
 * The entities exposed by TestDeploymentMeshService are fully typed.
 * TypeScript knows the exact shape of each entity and its operations.
 */
function demonstrateTypeSafety() {
  // ✅ These are fully typed - autocomplete works perfectly
  const deploymentQueries = TestDeploymentMeshService.entities.deployments.queries;
  const deploymentMutations = TestDeploymentMeshService.entities.deployments.mutations;

  // The list query accepts these filters (autocomplete available):
  // - serviceId?: string
  // - projectId?: string
  // - environment?: "prod" | "staging" | "dev"
  // - status?: "pending" | "running" | "stopped" | "failed"

  // The create mutation accepts these fields:
  // - serviceId: string
  // - projectId: string
  // - environment: "prod" | "staging" | "dev"
  // - status: "pending" | "running" | "stopped" | "failed"
  // - version: string
  // - replicas: number
  // - healthy: boolean

  console.log("Available queries:", Object.keys(deploymentQueries));
  console.log("Available mutations:", Object.keys(deploymentMutations));
}

// ─── Consumer Service Usage Examples ──────────────────────────────────────────

/**
 * Example usage patterns for TestDeploymentConsumerService.
 */
async function demonstrateConsumerUsage(
  consumer: TestDeploymentConsumerService
) {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("MESH DISCOVERY SYSTEM - USAGE EXAMPLES");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ─── 1. Basic Queries ─────────────────────────────────────────────────────
  console.log("1. BASIC QUERIES");
  console.log("─────────────────────────────────────────────────────────────────\n");

  // Get all running production deployments
  const prodDeployments = await consumer.getRunningProductionDeployments();
  console.log(`Found ${prodDeployments.total} running production deployments:`);
  prodDeployments.items.forEach((d) => {
    console.log(`  - ${d.deploymentId} (${d.serviceId}): ${d.status}, ${d.replicas} replicas`);
  });

  // Get deployments for a specific service
  const serviceDeployments = await consumer.getServiceDeployments("svc-1", {
    environment: "prod",
  });
  console.log(`\nService svc-1 has ${serviceDeployments.length} production deployments`);

  // Find a specific deployment
  const deployment = await consumer.findDeployment("dep-1");
  console.log(`\nFound deployment: ${deployment?.deploymentId ?? "not found"}`);

  // ─── 2. Projections (Select) ──────────────────────────────────────────────
  console.log("\n\n2. PROJECTIONS (SELECT)");
  console.log("─────────────────────────────────────────────────────────────────\n");

  const summaries = await consumer.getDeploymentSummaries();
  console.log(`Fetched ${summaries.length} deployment summaries:`);
  summaries.forEach((s) => {
    console.log(`  - ${s.deploymentId}: ${s.status} (${s.environment})`);
  });

  // ─── 3. Aggregations ──────────────────────────────────────────────────────
  console.log("\n\n3. AGGREGATIONS");
  console.log("─────────────────────────────────────────────────────────────────\n");

  const healthReport = await consumer.generateHealthReport();
  console.log("Deployment Health Report:");
  console.log(`  Total: ${healthReport.totalDeployments}`);
  console.log(`  Healthy: ${healthReport.healthyCount}`);
  console.log(`  Unhealthy: ${healthReport.unhealthyCount}`);
  console.log(`  Average replicas: ${healthReport.averageReplicas.toFixed(2)}`);
  console.log("  By environment:");
  Object.entries(healthReport.byEnvironment).forEach(([env, stats]) => {
    console.log(`    ${env}: ${stats.healthy} healthy, ${stats.unhealthy} unhealthy`);
  });

  const stats = await consumer.getDeploymentStats();
  console.log("\nDeployment Statistics:");
  console.log(`  Total: ${stats.total}`);
  console.log(`  Average replicas: ${stats.avgReplicas.toFixed(2)}`);
  console.log("  By status:", stats.byStatus);

  // ─── 4. Service Summaries ─────────────────────────────────────────────────
  console.log("\n\n4. SERVICE SUMMARIES");
  console.log("─────────────────────────────────────────────────────────────────\n");

  const serviceSummaries = await consumer.getServiceSummaries();
  console.log(`Found ${serviceSummaries.length} services:`);
  serviceSummaries.forEach((summary) => {
    console.log(`\n  Service: ${summary.serviceId}`);
    console.log(`    Deployments: ${summary.deployments.length}`);
    console.log(`    Latest version: ${summary.latestVersion ?? "N/A"}`);
    console.log(`    Total replicas: ${summary.totalReplicas}`);
  });

  // ─── 5. Complex Filtering ─────────────────────────────────────────────────
  console.log("\n\n5. COMPLEX FILTERING");
  console.log("─────────────────────────────────────────────────────────────────\n");

  const complexFiltered = await consumer.getDeploymentsWithComplexFilter();
  console.log(`Found ${complexFiltered.length} deployments with complex filter`);
  complexFiltered.forEach((d) => {
    console.log(`  - ${d.deploymentId}: ${d.environment}, ${d.replicas} replicas`);
  });

  // ─── 6. Health Diagnostics ────────────────────────────────────────────────
  console.log("\n\n6. HEALTH DIAGNOSTICS");
  console.log("─────────────────────────────────────────────────────────────────\n");

  const unhealthy = await consumer.findUnhealthyDeployments();
  console.log(`Found ${unhealthy.length} unhealthy deployments:`);
  unhealthy.forEach(({ deployment, issues }) => {
    console.log(`\n  ${deployment.deploymentId}:`);
    issues.forEach((issue) => console.log(`    ⚠️  ${issue}`));
  });

  // ─── 7. Query Introspection ───────────────────────────────────────────────
  console.log("\n\n7. QUERY INTROSPECTION");
  console.log("─────────────────────────────────────────────────────────────────\n");

  const queryPlan = consumer.explainDeploymentQuery();
  console.log("Query Plan:");
  console.log(queryPlan);

  // ─── 8. Streaming ─────────────────────────────────────────────────────────
  console.log("\n\n8. STREAMING");
  console.log("─────────────────────────────────────────────────────────────────\n");

  console.log("Processing deployments via stream...");
  let streamCount = 0;
  for await (const deployment of consumer.streamDeploymentUpdates()) {
    console.log(`  Streamed: ${deployment.deploymentId}`);
    streamCount++;
    if (streamCount >= 3) break; // Limit for demo
  }

  // ─── 9. Scoped Queries ────────────────────────────────────────────────────
  console.log("\n\n9. SCOPED QUERIES");
  console.log("─────────────────────────────────────────────────────────────────\n");

  const scopedDeployments = await consumer.getDeploymentsWithScope(
    "org-123",
    "broadcast-merge"
  );
  console.log(`Found ${scopedDeployments.length} deployments for org-123`);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("EXAMPLES COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

// ─── Builder Pattern Examples ─────────────────────────────────────────────────

/**
 * Examples of using the query builder directly.
 */
function demonstrateBuilderPatterns(
  consumer: TestDeploymentConsumerService,
  discovery: import("../services/system-mesh-resource-discovery/system-mesh-resource-discovery.service").SystemMeshResourceDiscoveryService
) {
  console.log("\nBUILDER PATTERN EXAMPLES");
  console.log("─────────────────────────────────────────────────────────────────\n");

  // The discovery service provides the entry point
  const { SystemMeshResourceDiscoveryService } = require(
    "../services/system-mesh-resource-discovery/system-mesh-resource-discovery.service"
  );

  // Build a query step by step
  const builder = discovery
    .from(TestDeploymentMeshService.queries.deployments)
    .where({ environment: "prod" })
    .where({ status: "running" })
    .orderBy("createdAt", "desc")
    .limit(100);

  // The builder type tracks the result shape through each operation
  // TypeScript knows the final result is MeshQueryResult<Deployment>

  console.log("Query builder created with type-safe operations:");
  console.log("  - where() filters");
  console.log("  - orderBy() sorting");
  console.log("  - limit() pagination");
  console.log("  - execute() to run");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Main execution function.
 * In a real test, you would use NestJS testing utilities to bootstrap.
 */
async function main() {
  console.log("Test Deployment Mesh Examples");
  console.log("Note: This requires a running NestJS application context.\n");

  demonstrateTypeSafety();

  // In a real scenario, you would:
  // const module = await Test.createTestingModule({
  //   imports: [TestDeploymentMeshModule],
  // }).compile();
  //
  // const consumer = module.get(TestDeploymentConsumerService);
  // await demonstrateConsumerUsage(consumer);

  console.log("\nTo run these examples:");
  console.log("1. Bootstrap a NestJS application with TestDeploymentMeshModule");
  console.log("2. Inject TestDeploymentConsumerService");
  console.log("3. Call the example methods");
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

// Export for testing
export { demonstrateTypeSafety, demonstrateConsumerUsage, demonstrateBuilderPatterns };
