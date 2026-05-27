/**
 * Mesh System - Examples
 *
 * This module provides comprehensive examples demonstrating the mesh resource
 * discovery system. It includes:
 *
 * 1. **TestDeploymentMeshService** - A mesh service exposing deployment entities
 * 2. **TestDeploymentConsumerService** - A consumer demonstrating discovery usage
 * 3. **TestDeploymentMeshModule** - A NestJS module wiring everything together
 * 4. **Comprehensive test suite** - Vitest specs covering all features
 *
 * ## Quick Start
 *
 * ```typescript
 * import { TestDeploymentMeshModule } from "./examples";
 * import { TestDeploymentConsumerService } from "./examples";
 *
 * @Module({
 *   imports: [TestDeploymentMeshModule],
 * })
 * export class MyModule {}
 *
 * // Inject the consumer
 * constructor(private consumer: TestDeploymentConsumerService) {}
 *
 * async example() {
 *   // Query running production deployments
 *   const deployments = await this.consumer.getRunningProductionDeployments();
 *
 *   // Get deployment statistics
 *   const stats = await this.consumer.getDeploymentStats();
 *
 *   // Find unhealthy deployments
 *   const unhealthy = await this.consumer.findUnhealthyDeployments();
 * }
 * ```
 *
 * ## Type Safety
 *
 * The mesh system is fully typed. TypeScript knows:
 * - The exact shape of each entity
 * - Valid filter fields for each query
 * - Result types after projections (select)
 * - Join result shapes
 *
 * ## Key Features Demonstrated
 *
 * - **Entity Definition**: Defining mesh entities with Zod schemas
 * - **Query Operations**: List, findById, search with typed filters
 * - **Mutations**: Create, update, delete, custom actions
 * - **Discovery**: Using SystemMeshResourceDiscoveryService
 * - **Builder Pattern**: Chaining where, select, orderBy, limit
 * - **Projections**: Selecting specific fields with type narrowing
 * - **Aggregations**: Count, sum, avg, groupBy operations
 * - **Streaming**: Async generators for real-time updates
 * - **Query Introspection**: Explaining query plans
 *
 * @module
 */

// Services
export { TestDeploymentMeshService } from "./test-deployment-mesh.service";
export { TestDeploymentConsumerService } from "./test-deployment-consumer.service";

// Module
export { TestDeploymentMeshModule } from "./test-deployment-mesh.module";

// Schemas (for reuse)
export {
  deploymentSchema,
  deploymentLogSchema,
  type Deployment,
  type DeploymentLog,
} from "./test-deployment-mesh.service";

// Examples (for documentation/testing)
export {
  demonstrateTypeSafety,
  demonstrateConsumerUsage,
  demonstrateBuilderPatterns,
} from "./test-deployment-mesh.example";
